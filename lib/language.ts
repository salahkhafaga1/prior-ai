import { Language } from '@/lib/i18n/translations';

const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

/**
 * Detect whether a text fragment is primarily Arabic.
 * Uses Arabic Unicode ranges; English/Latin + numerals return false.
 */
export function isArabicText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const sample = text.slice(0, 400);
  const arabicChars = (sample.match(ARABIC_RANGE) || []).length;
  const totalChars = sample.replace(/\s/g, '').length;
  if (totalChars === 0) return false;
  return arabicChars / totalChars >= 0.2;
}

/**
 * Normalize an incoming optional language field.
 * Priority: explicit value -> Arabic detected in the latest user message -> 'en'.
 */
export function resolveResponseLanguage(language?: string, userMessage?: string): Language {
  const normalized = (language || '').trim().toLowerCase();
  if (normalized === 'ar' || normalized === 'en') return normalized;
  if (userMessage && isArabicText(userMessage)) return 'ar';
  return 'en';
}