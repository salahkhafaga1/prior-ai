import { NextRequest, NextResponse } from 'next/server';
import zlib from 'zlib';
import { storePolicyDocument, PolicyDocument, logDiagnostic, logDiagnosticError } from '@/lib/supabase';
import { runLocalTesseractOCR, extractTextWithGemini } from '@/lib/imageProcessing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB limit
const MAX_CHUNK_LENGTH = 100000; // 100KB per text chunk
const CHUNK_OVERLAP = 1000;
const OCR_STAGE_TIMEOUT_MS = 45_000;
const PDF_PAGE_OCR_LIMIT = 30;
const PDF_PAGE_RENDER_CONCURRENCY = 4;
const PDF_PAGE_OCR_CONCURRENCY = 8;
const PDF_PAGE_OCR_TIMEOUT_MS = 15_000;
const PDF_PAGE_PIPELINE_TIMEOUT_MS = 50_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`OCR stage timed out after ${ms / 1000}s.`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Unescape PDF literal string escape sequences.
 */
function unescapePdfString(str: string): string {
  return str
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\b/g, '')
    .replace(/\\f/g, '')
    .replace(/\\\d{1,3}/g, ' ');
}

/**
 * Extract text from PDF content stream operators (Tj, TJ, hex strings).
 */
function parseTextOperators(streamContent: string): string {
  const textBlocks: string[] = [];

  // 1. Match (text) Tj and (text) ' / "
  const tjRegex = /\(((?:[^()\\]|\\.)*)\)\s*(?:T[jJ]|'|")/g;
  let match;
  while ((match = tjRegex.exec(streamContent)) !== null) {
    if (match[1]) {
      const clean = unescapePdfString(match[1]).trim();
      if (clean.length > 0) {
        textBlocks.push(clean);
      }
    }
  }

  // 2. Match [(text) 10 (text)] TJ arrays
  const arrayTjRegex = /\[(.*?)\]\s*TJ/g;
  while ((match = arrayTjRegex.exec(streamContent)) !== null) {
    const innerContent = match[1];
    const stringMatches = innerContent.match(/\(((?:[^()\\]|\\.)*)\)/g);
    if (stringMatches) {
      const line = stringMatches
        .map((s) => unescapePdfString(s.slice(1, -1)))
        .join('')
        .trim();
      if (line.length > 0) {
        textBlocks.push(line);
      }
    }
  }

  // 3. Match Hex strings <48656c6c6f> Tj
  const hexRegex = /<([0-9a-fA-F]{4,})>\s*T[jJ]/g;
  while ((match = hexRegex.exec(streamContent)) !== null) {
    try {
      const hexBuf = Buffer.from(match[1], 'hex');
      const decoded = hexBuf.toString('utf-8').replace(/[\x00-\x1F]/g, '').trim();
      if (decoded.length > 2 && /[a-zA-Z0-9]/.test(decoded)) {
        textBlocks.push(decoded);
      }
    } catch {}
  }

  return textBlocks.join(' ');
}

/**
 * Local stream text extractor for searchable PDFs.
 */
function extractLocalPDFText(buffer: Buffer): string {
  const textParts: string[] = [];
  const binaryContent = buffer.toString('binary');

  // Locate all stream ... endstream blocks in the PDF
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let streamMatch;

  while ((streamMatch = streamRegex.exec(binaryContent)) !== null) {
    const rawStreamBytes = Buffer.from(streamMatch[1], 'binary');

    let decompressedText: string | null = null;

    try {
      decompressedText = zlib.inflateSync(rawStreamBytes).toString('utf-8');
    } catch {
      try {
        decompressedText = zlib.inflateRawSync(rawStreamBytes).toString('utf-8');
      } catch {
        decompressedText = rawStreamBytes.toString('utf-8');
      }
    }

    if (decompressedText) {
      const operatorsText = parseTextOperators(decompressedText);
      if (operatorsText && operatorsText.length > 10) {
        textParts.push(operatorsText);
      }
    }
  }

  if (textParts.length === 0) {
    const directOperators = parseTextOperators(binaryContent);
    if (directOperators) {
      textParts.push(directOperators);
    }
  }

  const combined = textParts.join('\n');
  return combined
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Extract text using the pdfjs-dist reference engine (handles CID/ToUnicode
 * encoded fonts such as Arabic, where the regex-based extractor yields nothing).
 */
async function extractPdfTextWithPdfjs(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(pageText.trim());
    }
    return pages
      .join('\n')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Render PDF pages to JPEG buffers (server-side) using pdfjs + a WASM/N-API canvas.
 * Returns an array of page JPEG buffers (up to maxPages).
 */
async function renderPdfPagesToJpegs(buffer: Buffer, maxPages: number): Promise<Buffer[]> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  try {
    const pagesToRender = Math.min(doc.numPages, maxPages);
    const results: Buffer[] = new Array(pagesToRender);
    let index = 0;
    const workers = Array.from({ length: PDF_PAGE_RENDER_CONCURRENCY }, async () => {
      while (true) {
        const i = index++;
        if (i >= pagesToRender) break;
        const page = await doc.getPage(i + 1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = createCanvas(viewport.width, viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, viewport.width, viewport.height);
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise;
        results[i] = canvas.toBuffer('image/jpeg', 70);
      }
    });
    await Promise.all(workers);
    return results;
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * OCR a set of page JPEG buffers with Gemini in parallel and join the text.
 */
async function ocrPdfPagesInParallel(pageJpegs: Buffer[]): Promise<string> {
  const results: string[] = new Array(pageJpegs.length);
  let index = 0;
  const workers = Array.from({ length: PDF_PAGE_OCR_CONCURRENCY }, async () => {
    while (true) {
      const i = index++;
      if (i >= pageJpegs.length) break;
      try {
        const text = await withTimeout(
          extractTextWithGemini({ mimeType: 'image/jpeg', base64: pageJpegs[i].toString('base64') }),
          PDF_PAGE_OCR_TIMEOUT_MS
        );
        results[i] = text;
      } catch (err) {
        logDiagnosticError('[UPLOAD LOG]', `OCR failed for page ${i + 1}`, err);
        results[i] = '';
      }
    }
  });
  await Promise.all(workers);
  return results.filter((t) => t && t.trim().length > 0).join('\n\n');
}

/**
 * Validate that extracted text is legible and contains no raw %PDF stream headers.
 */
function isCleanReadableText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 80) return false;

  const lower = trimmed.toLowerCase();

  // Strictly reject raw PDF headers / stream tokens
  if (
    trimmed.startsWith('%PDF') ||
    lower.includes('%pdf-') ||
    lower.includes('endstream') ||
    lower.includes('startxref') ||
    lower.includes('/filter') ||
    lower.includes('/flatedecode')
  ) {
    return false;
  }

  const words = trimmed.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length < 15) return false;

  const letters = (trimmed.match(/\p{L}/gu) || []).length;
  const numerals = (trimmed.match(/\p{N}/gu) || []).length;
  if ((letters + numerals) / trimmed.length < 0.3) return false;

  return true;
}

/**
 * Chunk large document text into indexed slices for Supabase storage.
 */
function chunkDocumentText(text: string, chunkSize: number = MAX_CHUNK_LENGTH, overlap: number = CHUNK_OVERLAP): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize;
    if (endIndex < text.length) {
      const lastPeriod = text.lastIndexOf('.', endIndex);
      const lastNewline = text.lastIndexOf('\n', endIndex);
      const naturalBreak = Math.max(lastPeriod, lastNewline);

      if (naturalBreak > startIndex + chunkSize * 0.7) {
        endIndex = naturalBreak + 1;
      }
    }

    const chunk = text.slice(startIndex, endIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    startIndex = endIndex - overlap;
    if (startIndex >= text.length - overlap) {
      break;
    }
  }

  return chunks;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    logDiagnostic('[UPLOAD LOG]', 'Processing policy upload request (native PDF parse + Gemini Vision OCR)...');

    let payer = '';
    let content = '';
    let fileName = '';
    let ocrUsed = false;

    const contentType = req.headers.get('content-type') || '';

    // Handle Multipart Form Data
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      payer = (formData.get('payer') as string) || '';
      const file = formData.get('file') as File | null;
      const directContent = (formData.get('content') as string) || '';

      if (!payer.trim()) {
        return NextResponse.json(
          {
            success: false,
            error: '[Upload Validation Error] Payer Name is required (e.g. Aetna, Bupa, MetLife).',
          },
          { status: 400 }
        );
      }

      if (file) {
        fileName = file.name;
        if (file.size > MAX_FILE_SIZE_BYTES) {
          return NextResponse.json(
            {
              success: false,
              error: `[File Size Error] File exceeds 50MB limit (${(file.size / (1024 * 1024)).toFixed(1)}MB > 50MB).`,
            },
            { status: 413 }
          );
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const lowerName = file.name.toLowerCase();

        if (lowerName.endsWith('.pdf')) {
          logDiagnostic('[UPLOAD LOG]', `Parsing ${(file.size / (1024 * 1024)).toFixed(1)}MB PDF locally via Fast Stream Extractor...`);

          const nativeExtracted = extractLocalPDFText(buffer);

          if (isCleanReadableText(nativeExtracted)) {
            logDiagnostic('[UPLOAD LOG]', `Fast native extraction succeeded (${nativeExtracted.length} clean characters).`);
            content = nativeExtracted;
          } else {
            let pdfjsText = '';
            try {
              const pdfjsStart = Date.now();
              pdfjsText = await extractPdfTextWithPdfjs(buffer);
              logDiagnostic(
                '[UPLOAD LOG]',
                `pdfjs text extraction produced ${pdfjsText.length} characters in ${Date.now() - pdfjsStart}ms.`
              );
            } catch (pdfjsErr: any) {
              logDiagnosticError('[UPLOAD LOG]', 'pdfjs text extraction failed', pdfjsErr);
            }

            if (isCleanReadableText(pdfjsText)) {
              logDiagnostic('[UPLOAD LOG]', 'pdfjs extracted clean text (Arabic/CID fonts decoded).');
              content = pdfjsText;
              ocrUsed = true;
            } else {
              // Scanned PDF -> render pages to images + parallel per-page OCR
              logDiagnostic('[UPLOAD LOG]', 'Native and pdfjs extraction found no clean text. Rendering pages for parallel OCR...');
              let pageOcrText = '';
              let pageRenderError: unknown = null;
              let pagesRendered = 0;
              try {
                const pagePipeline = (async () => {
                  const renderStart = Date.now();
                  const pageJpegs = await renderPdfPagesToJpegs(buffer, PDF_PAGE_OCR_LIMIT);
                  pagesRendered = pageJpegs.length;
                  logDiagnostic(
                    '[UPLOAD LOG]',
                    `Rendered ${pageJpegs.length} page(s) in ${Date.now() - renderStart}ms.`
                  );
                  if (pageJpegs.length === 0) return '';
                  const ocrStart = Date.now();
                  const text = await ocrPdfPagesInParallel(pageJpegs);
                  logDiagnostic(
                    '[UPLOAD LOG]',
                    `Page OCR produced ${text.length} chars in ${Date.now() - ocrStart}ms.`
                  );
                  return text;
                })();
                pageOcrText = await withTimeout(pagePipeline, PDF_PAGE_PIPELINE_TIMEOUT_MS);
              } catch (pageOcrErr: any) {
                pageRenderError = pageOcrErr;
                logDiagnosticError('[UPLOAD LOG]', 'PDF page OCR pipeline failed or timed out', pageOcrErr);
              }

              if (isCleanReadableText(pageOcrText)) {
                content = pageOcrText;
                ocrUsed = true;
                logDiagnostic('[UPLOAD LOG]', 'Page OCR produced clean policy text.');
              } else {
                logDiagnostic('[UPLOAD LOG]', `Page OCR produced insufficient text. Raw length: ${pageOcrText.length}.`);
                return NextResponse.json(
                  {
                    success: false,
                    error:
                      '[OCR Engine] Could not extract legible text from this PDF. Please upload the policy as a .txt file or paste the text directly.',
                    ocrError: pageRenderError
                      ? pageRenderError instanceof Error
                        ? pageRenderError.message
                        : String(pageRenderError)
                      : pageOcrText.length > 0
                        ? 'Page OCR text failed cleanliness checks'
                        : 'PDF page OCR produced no text',
                    ocrChars: pageOcrText.length,
                    pagesRendered,
                  },
                  { status: 422 }
                );
              }
            }
        }
        } else if (lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
          // Direct Image File -> Gemini Vision OCR first, local Tesseract as fallback
          logDiagnostic('[UPLOAD LOG]', `Image policy uploaded (${lowerName}). Running Gemini Vision OCR...`);
          const imageBase64 = buffer.toString('base64');
          if (file.size <= 8 * 1024 * 1024) {
            try {
              content = await withTimeout(
                extractTextWithGemini({ mimeType: file.type || 'image/png', base64: imageBase64 }),
                OCR_STAGE_TIMEOUT_MS
              );
              ocrUsed = true;
            } catch (geminiErr: any) {
              logDiagnosticError('[UPLOAD LOG]', 'Gemini Vision OCR failed for image; falling back to Tesseract', geminiErr);
              content = await withTimeout(runLocalTesseractOCR(buffer), OCR_STAGE_TIMEOUT_MS);
              ocrUsed = true;
            }
          } else {
            content = await withTimeout(runLocalTesseractOCR(buffer), OCR_STAGE_TIMEOUT_MS);
            ocrUsed = true;
          }
        } else {
          // Plain text file (.txt, .md, .csv)
          content = buffer.toString('utf-8').trim();
        }
      } else if (directContent.trim()) {
        content = directContent.trim();
      } else {
        return NextResponse.json(
          {
            success: false,
            error: '[Upload Validation Error] Please select a PDF or TXT file or paste the policy text.',
          },
          { status: 400 }
        );
      }
    } else {
      // JSON Payload
      const jsonBody = await req.json();
      payer = jsonBody.payer || '';
      content = jsonBody.content || '';
      fileName = jsonBody.title || '';
    }

    // Final Cleanliness Validation
    if (!payer.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: '[Upload Validation Error] Payer Name is required.',
        },
        { status: 400 }
      );
    }

    if (!isCleanReadableText(content)) {
      return NextResponse.json(
        {
          success: false,
          error: '[Upload Error] Document text contains insufficient content or corrupted data.',
        },
        { status: 422 }
      );
    }

    const baseTitle = fileName
      ? fileName.replace(/\.[^/.]+$/, '')
      : `${payer.trim()} Clinical Policy Guidelines`;

    // Multi-chunk database storage
    const textChunks = chunkDocumentText(content);
    logDiagnostic('[UPLOAD LOG]', `Storing ${textChunks.length} clean text chunk(s) into Supabase...`);

    let insertedCount = 0;
    for (let i = 0; i < textChunks.length; i++) {
      const chunkTitle = textChunks.length > 1 ? `${baseTitle} (Part ${i + 1}/${textChunks.length})` : baseTitle;
      const chunkDoc: PolicyDocument = {
        payer: payer.trim(),
        title: chunkTitle,
        procedure_type: 'General Policy',
        clause_section: `Section ${i + 1}.0 - Coverage Criteria`,
        content: textChunks[i],
      };

      const result = await storePolicyDocument(chunkDoc);
      if (result.error) {
        logDiagnosticError('[UPLOAD LOG]', `Supabase insertion failed on chunk ${i + 1}`, result.error);
        return NextResponse.json(
          {
            success: false,
            error: `[Supabase Error] Database write failed: ${result.error.message}`,
          },
          { status: 500 }
        );
      }
      insertedCount++;
    }

    logDiagnostic('[UPLOAD LOG]', `Successfully saved policy for "${payer}" (${content.length} clean characters in ${insertedCount} chunk(s)). OCR Used: ${ocrUsed}. Total time: ${Date.now() - startTime}ms.`);

    return NextResponse.json({
      success: true,
      payer: payer.trim(),
      textLength: content.length,
      chunksStored: insertedCount,
      ocrUsed,
      message: `Policy for ${payer} successfully processed and stored.`,
    });
  } catch (err: any) {
    logDiagnosticError('[UPLOAD LOG]', 'Unhandled exception in local policy upload API', err);
    return NextResponse.json(
      {
        success: false,
        error: `[Local PDF Parser] Failed to parse document: ${err?.message || 'Server error'}`,
      },
      { status: 500 }
    );
  }
}
