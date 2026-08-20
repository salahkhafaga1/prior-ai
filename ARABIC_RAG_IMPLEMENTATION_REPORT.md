# Arabic + English Support for MEDAI RAG Prior-Authorization App

## 1. Overview

This change adds first-class Arabic and English support to the MEDAI RAG prior-authorization application. The system now:

- Lets users chat in Arabic or English via a UI language switch.
- Detects Arabic automatically from the user message when no explicit language is sent.
- Returns answers, summaries, and missing-requirement explanations in the detected language.
- Keeps the retrieved policy evidence **verbatim in its original (English) form** with original citations — policy text is never translated, preserving evidence integrity.
- Detects the payer from an Arabic-only query by translating just the payer identification step (the user's Arabic prompt itself is preserved for reasoning).
- Reads Arabic text in uploaded images (Gemini OCR) and falls back to a Tesseract engine that loads Arabic (`ara`) + English (`eng`) language packs.
- Generates image captions in the requested response language.

The English workflow is fully preserved (backward compatible).

## 2. Files Changed

| File | Change |
|------|--------|
| `lib/i18n/translations.ts` | **New.** Typed `en`/`ar` dictionaries for all UI strings (ChatWorkspace, PolicySidebar, PriorAuthReportView) + server-error messages. `formatString` helper for `{n}` placeholders. |
| `lib/i18n/LanguageContext.tsx` | **New.** React context: `useLanguage()` exposes `t()`, `translateServerError()`, `setLanguage()`, `toggleLanguage()`, `dir`. Persists choice in `localStorage`, syncs `<html lang/dir>`. |
| `lib/language.ts` | **New.** `isArabicText()` (Unicode Arabic block detection on the first 400 chars) and `resolveResponseLanguage()` (explicit field > Arabic detection > `en`). |
| `app/page.tsx` | Wraps the app in `LanguageProvider`. |
| `app/globals.css` | RTL Arabic font-family rule for `html[dir="rtl"]`; opt-in `.ltr-isolate` class for technical tokens that must stay LTR. |
| `components/ChatWorkspace.tsx` | Full localization + RTL-aware layout classes (`ms/me/ps/pe/start/end/text-start`), `dir="auto"` on Arabic-capable prose, `dir="ltr"` on payer tags/clauses/quotes, `English | العربية` switch button, sends `language` in the `/api/chat` payload, translates server errors client-side. |
| `components/PolicySidebar.tsx` | Localized + RTL-aware; `dir="ltr"` on payer names/filenames; fixed delete-success message. |
| `components/PriorAuthReportView.tsx` | Localized Arabic report labels, RTL table layout, `ltr-isolate` on clauses/quotes/doc refs, `dir="auto"` on Arabic prose. |
| `app/api/chat/route.ts` | Reads `language` field; computes `effectiveLanguage`; extended system instruction (rules 9–17) for response language, citations, clinical context, image descriptions, medical terminology, and Arabic report format; injects `RESPONSE_LANGUAGE` into the prompt; Arabic cross-language payer fallback; returns `responseLanguage`. |
| `lib/imageProcessing.ts` | `runLocalTesseractOCR(buffer, ['eng','ara'])` with fallback to `'eng'`; language-aware OCR + caption instructions; `generateImageCaption(input, language)` and `processClinicalImage(input, { language })`. |

## 3. RAG Behavior

### 3.1 Language resolution (`resolveResponseLanguage`)
Priority: explicit `language` field (`ar`/`en`) → Arabic detected in the message (≥20% Arabic Unicode in first 400 chars) → `en`.

### 3.2 Arabic query → English evidence → Arabic answer
The retrieval layer is unchanged: the policy chunks stored in Supabase are matched by payer. The retrieved evidence is the **original English policy text**. The Gemini prompt tells the model to answer in `RESPONSE_LANGUAGE` while **quoting the policy verbatim in its original English form** and giving original citations. This guarantees that Arabic answers are always backed by the exact English policy language the reviewer can verify.

### 3.3 Arabic-only payer identification
When the query is Arabic and contains no `@Payer` tag and no Latin payer name, a lightweight Gemini call translates only the payer-identification fragment (`translateQueryForRetrieval`). The **original Arabic prompt is still used** for reasoning; the translation is used only to pick the payer so retrieval can proceed. No policy content is translated.

### 3.4 Image understanding
- Gemini OCR instruction now says to transcribe **verbatim** whether the text is English, Arabic, or mixed, preserving original scripts, numbers, codes, and medication names.
- If Gemini OCR is unavailable, Tesseract loads `['eng','ara']` and falls back to `'eng'`.
- `generateImageCaption` injects `RESPONSE_LANGUAGE` so descriptions are produced in the answer language while keeping codes/numbers/identifiers in their original form.

## 4. Citation Integrity

- Quotes, clause references (`sectionClause`), document references, payer names, and policy titles are always returned in their **original English form**.
- Narrative, reasoning, and missing-requirement explanations follow the response language.
- Policy text is never machine-translated, so Arabic answers stay traceable to the exact English source.

## 5. Backward Compatibility

- `language` is **optional** in `/api/chat`. Existing English clients that omit it receive `en`.
- All response fields are unchanged; only `responseLanguage` is added.
- UI defaults to English for new visitors; the language choice persists per browser.

## 6. Verification

Build, type-check, and lint pass locally. Then the app was run locally against the production database (Supabase) and against the deployed Vercel endpoint.

### Local end-to-end results (against real `uhc` policy)

| Test | Input | Result |
|------|-------|--------|
| A | Arabic query + `@uhc`, no language field | `lang=ar`; Arabic summary; Arabic missing-requirements |
| B | Arabic query, no payer tag, no language | `lang=ar`; cross-language payer fallback ran; Arabic summary |
| C | English query + `language: "en"` | `lang=en`; English summary |
| D | English query, no language field | `lang=en` (default preserved) |
| E | Arabic clinical note (Arabic-Indic digits ٨/١٢) + Arabic question + `@uhc` | `lang=ar`; Arabic summary; English citation (`Ablative Treatment for Spinal Pain Page 1 of 14 ...`), clause `Section 1.0 - Coverage Criteria`, Arabic evidence note with original English medical terms |

### Production (Vercel) results

| Test | Input | Result |
|------|-------|--------|
| Arabic | Arabic clinical note + `@uhc` | HTTP 200, `lang=ar`, Arabic summary naming the retrieved policy in English + Arabic |
| English | English note + `language: "en"` | HTTP 200, `lang=en`, English summary with retrieved policy title `UnitedHealthcare_Lumbar_Policy` |

### Image route
The image pipeline (Gemini OCR → Tesseract `eng+ara` fallback → language-aware caption) is wired and exercised; full Gemini image-caption verification was limited by the free-tier Gemini daily quota (20 req/day/model) which was exhausted by the test suite. Gemini's OCR natively handles Arabic images; the fallback path also loads the `ara` Tesseract language pack.

## 7. Known Limitations

- Free-tier Gemini quota (~20 req/day/model) limits heavy testing and concurrency.
- Tesseract fallback renders Arabic text without full glyph shaping in some fonts.
- Only the three active UI surfaces (chat workspace, policy sidebar, prior-auth report) were localized; unused demo components (`Header`, `PatientInputForm`, `AnalysisResultView`, `prior-auth/analyze`) were left untouched.

## 8. Recommended Next Steps

- Add language metadata to uploaded policies and restrict retrieval to matching-language chunks if policy DBs become multilingual.
- Add automated tests for `isArabicText` / `resolveResponseLanguage` (pure functions).
- Upgrade to a paid Gemini tier for higher request quota.