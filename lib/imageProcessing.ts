import { GoogleGenAI, Type, GenerateContentResponse } from '@google/genai';
import {
  ImageAttachmentRequest,
  ImageCaption,
  ProcessedImageAttachment,
} from '@/types/imageProcessing';
import { logDiagnostic, logDiagnosticError } from '@/lib/supabase';

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB
export const MAX_IMAGES_PER_REQUEST = 5;

const OCR_MIN_TEXT_LENGTH = 20;

// Verified stable Gemini vision-capable model IDs (Google AI docs).
const CAPTION_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];

// Gemini inlineData payload limits (conservative): images 8MB, PDFs 15MB.
const GEMINI_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const GEMINI_PDF_MAX_BYTES = 15 * 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CAPTION_SYSTEM_INSTRUCTION = `You are a medical document image analysis assistant. You analyze an image uploaded to a medical prior-authorization application.

STRICT RULES:
1. Describe ONLY what is actually visible in the image. Do not invent information.
2. Do not diagnose medical conditions or infer patient information that is not visibly present.
3. Do not fabricate measurements, values, dates, or clinical facts. If a value is unreadable or absent, state that it is not visible.
4. Distinguish visible text from visual interpretation. Visible text belongs under "visibleTextSummary"; your visual interpretation belongs under "description".
5. Keep the description concise and clinically useful (2-5 sentences).
6. Do not generate policy citations, coverage determinations, or authorization verdicts.
7. Set "confidence" to "low", "medium", or "high" indicating how certain you are about what the image type is.

Return JSON with fields: imageType, description, visibleTextSummary, confidence.`;

const CAPTION_JSON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    imageType: {
      type: Type.STRING,
      description:
        'Type of image, e.g. medical_report, lab_result, imaging_study, prescription, clinical_note, other',
    },
    description: {
      type: Type.STRING,
      description: 'Concise visual interpretation of what is visible in the image',
    },
    visibleTextSummary: {
      type: Type.STRING,
      description: 'Summary of text actually visible in the image',
    },
    confidence: {
      type: Type.STRING,
      enum: ['low', 'medium', 'high'],
      description: 'Confidence in the identified image type',
    },
  },
  required: ['imageType', 'description', 'visibleTextSummary', 'confidence'],
};

export function normalizeImageMimeType(mimeType: string): string {
  const normalized = (mimeType || '').trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized;
}

/**
 * Detect the actual image format from magic bytes so we never feed
 * undecodable data to the Tesseract worker (which would crash the process).
 */
function detectImageFormat(buffer: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Run local Tesseract.js OCR on an image/document buffer.
 * 100% local, zero external API costs. Shared by the policy upload and chat pipelines.
 */
export async function runLocalTesseractOCR(buffer: Buffer): Promise<string> {
  logDiagnostic('[IMAGE LOG]', 'Initiating local Tesseract OCR engine on image buffer...');
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');

    const ret = await worker.recognize(buffer);
    await worker.terminate();

    const ocrText = ret?.data?.text || '';
    logDiagnostic('[IMAGE LOG]', `Local Tesseract OCR extracted ${ocrText.length} characters.`);
    return ocrText;
  } catch (err) {
    logDiagnosticError('[IMAGE LOG]', 'Local Tesseract OCR failed', err);
    throw new Error(
      `Local OCR processing error: ${err instanceof Error ? err.message : 'Please ensure tesseract.js is installed via npm install tesseract.js'}`
    );
  }
}

const OCR_SYSTEM_INSTRUCTION = `You are a medical document text extraction engine.
Your ONLY task is to transcribe ALL visible text in the provided document VERBATIM.
RULES:
1. Preserve the original reading order and layout as closely as possible.
2. Include headings, numbers, dates, and table content.
3. Do NOT summarize, interpret, diagnose, or add commentary.
4. If the document has no readable text, return the exact string: NO_READABLE_TEXT`;

/**
 * Extract text from a document (image or PDF) using the Gemini Vision API.
 * Much faster and more reliable than local Tesseract on serverless functions.
 * Throws if no text could be extracted or the API key is missing.
 */
export async function extractTextWithGemini(input: {
  mimeType: string;
  base64: string;
}): Promise<string> {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_actual_gemini_api_key_here' || apiKey.trim() === '') {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const ai = new GoogleGenAI({ apiKey });
  let response: GenerateContentResponse | null = null;
  let lastError: unknown = null;

  for (const modelName of CAPTION_MODELS) {
    try {
      logDiagnostic('[IMAGE LOG]', `Attempting Gemini OCR with model: "${modelName}"...`);
      response = await ai.models.generateContent({
        model: modelName,
        contents: [
          { inlineData: { mimeType: input.mimeType, data: input.base64 } },
          { text: 'Transcribe every piece of visible text in this document verbatim.' },
        ],
        config: {
          systemInstruction: OCR_SYSTEM_INSTRUCTION,
          temperature: 0,
        },
      });
      logDiagnostic('[IMAGE LOG]', `Gemini OCR succeeded with model "${modelName}".`);
      break;
    } catch (err) {
      lastError = err;
      logDiagnosticError(
        '[IMAGE LOG]',
        `Gemini OCR model ${modelName} failed: ${err instanceof Error ? err.message : String(err)}`
      );
      await sleep(1000);
    }
  }

  const rawText = response?.text?.trim() || '';
  if (!rawText || rawText === 'NO_READABLE_TEXT') {
    throw lastError || new Error('Gemini OCR returned no readable text.');
  }

  return rawText;
}

function renderCaption(caption: ImageCaption): string {
  const parts: string[] = [];
  if (caption.imageType) parts.push(`Image type: ${caption.imageType}`);
  if (caption.confidence) parts.push(`Confidence: ${caption.confidence}`);
  if (caption.description) parts.push(caption.description);
  if (caption.visibleTextSummary) parts.push(`Visible text (AI-extracted): ${caption.visibleTextSummary}`);
  return parts.join(' | ');
}

/**
 * Generate a concise image understanding / caption using the existing Gemini integration.
 * Descriptive context only; never treated as authoritative medical evidence.
 */
export async function generateImageCaption(input: {
  mimeType: string;
  base64: string;
}): Promise<ImageCaption> {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_actual_gemini_api_key_here' || apiKey.trim() === '') {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const ai = new GoogleGenAI({ apiKey });
  let response: GenerateContentResponse | null = null;
  let lastError: unknown = null;

  for (const modelName of CAPTION_MODELS) {
    try {
      logDiagnostic('[IMAGE LOG]', `Attempting image understanding with model: "${modelName}"...`);
      response = await ai.models.generateContent({
        model: modelName,
        contents: [
          { inlineData: { mimeType: input.mimeType, data: input.base64 } },
          { text: 'Analyze this medical-related image and return the requested JSON.' },
        ],
        config: {
          systemInstruction: CAPTION_SYSTEM_INSTRUCTION,
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: CAPTION_JSON_SCHEMA,
        },
      });
      logDiagnostic('[IMAGE LOG]', `Image understanding succeeded with model "${modelName}".`);
      break;
    } catch (err) {
      lastError = err;
      logDiagnosticError(
        '[IMAGE LOG]',
        `Model ${modelName} failed: ${err instanceof Error ? err.message : String(err)}`
      );
      await sleep(1000);
    }
  }

  const rawText = response?.text;
  if (!rawText) {
    throw lastError || new Error('Empty image understanding response from Gemini.');
  }

  const parsed = JSON.parse(rawText) as ImageCaption;
  return {
    imageType: parsed.imageType || 'other',
    description: parsed.description || '',
    visibleTextSummary: parsed.visibleTextSummary || '',
    confidence: parsed.confidence || 'low',
  };
}

/**
 * Process a single attached clinical image: OCR + image understanding.
 * Each stage fails independently and gracefully; never throws.
 */
export async function processClinicalImage(input: ImageAttachmentRequest): Promise<ProcessedImageAttachment> {
  const mimeType = normalizeImageMimeType(input.mimeType);
  const fileName = input.fileName || 'image';

  const result: ProcessedImageAttachment = {
    fileName,
    mimeType,
    sizeBytes: input.sizeBytes,
    ocrText: null,
    imageDescription: null,
    caption: null,
    ocrStatus: 'OCR_FAILED',
    captionStatus: 'CAPTION_FAILED',
    processingStatus: 'FAILED',
    error: null,
  };

  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    result.error = { phase: 'ocr', message: `Unsupported image type: ${input.mimeType || 'unknown'}` };
    return result;
  }

  if (input.sizeBytes && input.sizeBytes > MAX_IMAGE_SIZE_BYTES) {
    result.error = {
      phase: 'ocr',
      message: `Image exceeds ${MAX_IMAGE_SIZE_BYTES / (1024 * 1024)}MB limit.`,
    };
    return result;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(input.data, 'base64');
  } catch {
    result.error = { phase: 'ocr', message: 'Invalid base64 image data.' };
    return result;
  }

  if (buffer.length === 0) {
    result.error = { phase: 'ocr', message: 'Empty image data.' };
    return result;
  }

  const detectedFormat = detectImageFormat(buffer);
  if (!detectedFormat) {
    result.error = {
      phase: 'ocr',
      message: 'Image data could not be decoded as a supported format (PNG/JPEG/WEBP).',
    };
    return result;
  }

  // A. OCR pipeline (Gemini Vision first, local Tesseract as fallback)
  let ocrText = '';
  let ocrError: unknown = null;

  try {
    if (input.sizeBytes && input.sizeBytes > GEMINI_IMAGE_MAX_BYTES) {
      throw new Error(`Image exceeds ${GEMINI_IMAGE_MAX_BYTES / (1024 * 1024)}MB Gemini OCR limit; using local OCR.`);
    }
    ocrText = await extractTextWithGemini({ mimeType, base64: input.data });
  } catch (geminiErr) {
    ocrError = geminiErr;
    logDiagnosticError('[IMAGE LOG]', 'Gemini OCR failed; falling back to Tesseract', geminiErr);
  }

  if (!ocrText.trim()) {
    if (detectedFormat === 'webp') {
      // Tesseract.js decoding of WebP is unreliable; skip OCR to avoid a worker crash.
      result.ocrStatus = 'OCR_FAILED';
      result.error = {
        phase: 'ocr',
        message: ocrError instanceof Error ? ocrError.message : 'WebP images are not supported by the local OCR engine; image understanding was attempted instead.',
      };
    } else {
      try {
        const text = await runLocalTesseractOCR(buffer);
        ocrText = text.trim();
      } catch (err) {
        ocrError = err;
      }
    }
  }

  if (ocrText.trim().length >= OCR_MIN_TEXT_LENGTH) {
    result.ocrText = ocrText.trim();
    result.ocrStatus = 'OCR_SUCCESS';
  } else if (ocrText.trim().length > 0) {
    result.ocrText = ocrText.trim();
    result.ocrStatus = 'OCR_PARTIAL';
  } else {
    result.ocrStatus = 'OCR_FAILED';
    if (!result.error) {
      result.error = {
        phase: 'ocr',
        message: ocrError instanceof Error ? ocrError.message : 'No readable text detected in image.',
      };
    }
  }

  // B. Image understanding pipeline (Gemini vision)
  try {
    const caption = await generateImageCaption({ mimeType, base64: input.data });
    result.caption = caption;
    result.imageDescription = renderCaption(caption);
    result.captionStatus = 'CAPTION_SUCCESS';
  } catch (err) {
    result.captionStatus = 'CAPTION_FAILED';
    if (!result.error) {
      result.error = {
        phase: 'caption',
        message: err instanceof Error ? err.message : 'Image understanding failed.',
      };
    }
  }

  result.processingStatus =
    result.ocrStatus === 'OCR_SUCCESS' && result.captionStatus === 'CAPTION_SUCCESS'
      ? 'SUCCESS'
      : result.ocrStatus === 'OCR_FAILED' && result.captionStatus === 'CAPTION_FAILED'
        ? 'FAILED'
        : 'PARTIAL';

  logDiagnostic(
    '[IMAGE LOG]',
    `Image "${fileName}" processed: ${result.ocrStatus} / ${result.captionStatus} (${result.processingStatus}).`
  );
  return result;
}