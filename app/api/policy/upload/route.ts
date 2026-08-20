import { NextRequest, NextResponse } from 'next/server';
import zlib from 'zlib';
import { storePolicyDocument, PolicyDocument, logDiagnostic, logDiagnosticError } from '@/lib/supabase';
import { runLocalTesseractOCR, extractTextWithGemini } from '@/lib/imageProcessing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB limit
const MAX_CHUNK_LENGTH = 100000; // 100KB per text chunk
const CHUNK_OVERLAP = 1000;

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

  const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
  if (alphaCount / trimmed.length < 0.35) return false;

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
  try {
    logDiagnostic('[UPLOAD LOG]', 'Processing policy upload request (Local Fast Stream + Tesseract OCR Fallback)...');

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
            // Flat scanned PDF or unindexed image -> Gemini Vision OCR (fast) then local Tesseract as last resort
            logDiagnostic('[UPLOAD LOG]', 'Native extraction found flat scanned image. Attempting Gemini Vision OCR...');
            const pdfBase64 = buffer.toString('base64');
            let geminiText = '';
            if (file.size <= 15 * 1024 * 1024) {
              try {
                geminiText = await extractTextWithGemini({ mimeType: 'application/pdf', base64: pdfBase64 });
                logDiagnostic('[UPLOAD LOG]', `Gemini Vision OCR extracted ${geminiText.length} characters.`);
              } catch (geminiErr: any) {
                logDiagnosticError('[UPLOAD LOG]', 'Gemini Vision OCR failed for PDF', geminiErr);
              }
            } else {
              logDiagnostic('[UPLOAD LOG]', 'PDF exceeds Gemini 15MB limit; skipping Gemini OCR.');
            }

            if (isCleanReadableText(geminiText)) {
              content = geminiText;
              ocrUsed = true;
            } else {
              logDiagnostic('[UPLOAD LOG]', 'Gemini OCR insufficient. Falling back to local Tesseract OCR...');
              try {
                const ocrResult = await runLocalTesseractOCR(buffer);
                if (isCleanReadableText(ocrResult)) {
                  content = ocrResult;
                  ocrUsed = true;
                  logDiagnostic('[UPLOAD LOG]', `Local Tesseract OCR successfully extracted ${ocrResult.length} clean characters.`);
                } else {
                  return NextResponse.json(
                    {
                      success: false,
                      error:
                        '[OCR Engine] Could not extract legible text from this scanned PDF. Please ensure the document is clear or upload a .txt version.',
                    },
                    { status: 422 }
                  );
                }
              } catch (ocrErr: any) {
                logDiagnosticError('[UPLOAD LOG]', 'Local Tesseract OCR exception', ocrErr);
                return NextResponse.json(
                  {
                    success: false,
                    error: `[OCR Engine] OCR failed: ${ocrErr?.message || 'Could not process scanned document'}`,
                  },
                  { status: 422 }
                );
              }
            }
          }
        } else if (lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
          // Direct Image File -> Gemini Vision OCR first, local Tesseract as fallback
          logDiagnostic('[UPLOAD LOG]', `Image policy uploaded (${lowerName}). Running Gemini Vision OCR...`);
          try {
            const imageBase64 = buffer.toString('base64');
            if (file.size <= 8 * 1024 * 1024) {
              try {
                content = await extractTextWithGemini({ mimeType: file.type || 'image/png', base64: imageBase64 });
                ocrUsed = true;
              } catch (geminiErr: any) {
                logDiagnosticError('[UPLOAD LOG]', 'Gemini Vision OCR failed for image', geminiErr);
                content = await runLocalTesseractOCR(buffer);
                ocrUsed = true;
              }
            } else {
              content = await runLocalTesseractOCR(buffer);
              ocrUsed = true;
            }
          } catch (ocrErr: any) {
            return NextResponse.json(
              {
                success: false,
                error: `[OCR Engine] Failed to OCR image: ${ocrErr?.message}`,
              },
              { status: 422 }
            );
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

    logDiagnostic('[UPLOAD LOG]', `Successfully saved policy for "${payer}" (${content.length} clean characters in ${insertedCount} chunk(s)). OCR Used: ${ocrUsed}`);

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
