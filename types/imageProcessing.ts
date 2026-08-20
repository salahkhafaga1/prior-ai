export type OcrProcessingStatus = 'OCR_SUCCESS' | 'OCR_PARTIAL' | 'OCR_FAILED';
export type CaptionProcessingStatus = 'CAPTION_SUCCESS' | 'CAPTION_FAILED';
export type ImageProcessingStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface ImageCaption {
  imageType: string;
  description: string;
  visibleTextSummary: string;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Image sent from the client to /api/chat.
 * `data` is base64-encoded image bytes (never include it in logs).
 */
export interface ImageAttachmentRequest {
  fileName: string;
  mimeType: string;
  data: string;
  sizeBytes?: number;
}

/**
 * Result of server-side image processing (OCR + image understanding).
 * Backward-compatible addition to the /api/chat response.
 */
export interface ProcessedImageAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  ocrText: string | null;
  imageDescription: string | null;
  caption: ImageCaption | null;
  ocrStatus: OcrProcessingStatus;
  captionStatus: CaptionProcessingStatus;
  processingStatus: ImageProcessingStatus;
  error: { phase: 'ocr' | 'caption'; message: string } | null;
}