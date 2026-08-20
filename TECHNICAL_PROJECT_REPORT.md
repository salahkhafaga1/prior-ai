# TECHNICAL PROJECT REPORT
## MEDAI — Medical Prior Authorization Copilot (RAG)

**Project:** `medairag-app` · **Stack:** Next.js 16 (App Router) · **Report date:** 2026-08-20

This report is derived **exclusively** from the actual source code in this repository and from runtime observations made during development and deployment verification. Nothing is invented. Items that are planned, absent, or only partially implemented are explicitly labelled.

---

## 1. Executive Technical Overview

MEDAI is a full-stack medical **prior-authorization (PA) copilot** that helps physicians determine, in a few seconds, whether a requested procedure is likely to be covered by a specific health-insurance payer — and, if it is, produce a formal, physician-ready "medical necessity" justification letter.

**The problem it solves.** Prior authorization is one of the most time-consuming and error-prone administrative tasks in clinical practice. Insurers publish large policy bulletins (e.g. "Aetna CPB 0236 – MRI of the Spine") with precise coverage criteria: minimum symptom duration, required conservative therapies (e.g. ≥6 weeks of physical therapy + NSAIDs), and objective exam findings (e.g. positive straight-leg-raise). Matching a patient chart against those criteria by hand is slow and inconsistent, and every insurer has its own document.

**Who uses it.** Clinical staff and physicians who must submit prior-authorization requests and justify medical necessity.

**Why AI/RAG.** The system does not "answer from the model's memory." It uses **Retrieval-Augmented Generation**: the user's clinical note is evaluated **only against policy text retrieved from the database** for the tagged payer (`@uhc`, `@aetna`, …). This is what makes verdicts verifiable and defensible — every checklist row must cite an exact policy clause and a verbatim quote from the stored document.

**What makes it different from a generic medical chatbot.**
1. **Grounded, not generative** — the model is instructed it may rely ONLY on the retrieved policy document; it is forced to output a strict JSON schema (`app/api/chat/route.ts`).
2. **Citation integrity** — every criterion carries `sectionClause` + `exactPolicyQuote` + `patientEvidence`.
3. **Refusal behavior** — if clinical detail is missing, the engine refuses to fabricate a letter and instead asks for symptom duration, conservative treatment history, and the target payer.
4. **Multimodal intake** — physicians can attach clinical images (EHR screenshots, lab results); the system runs OCR + image understanding, but treats that as *patient context*, never as policy evidence.

> **One-paragraph technical summary for judges:** MEDAI is a Next.js 16 full-stack RAG application. Insurance policy PDFs are ingested through a text-extraction pipeline (native PDF stream parsing → Gemini Vision OCR → Tesseract.js fallback), cleaned, chunked, and persisted in a Supabase `policy_documents` table. At query time, a `@PayerName` tag is used to retrieve the relevant policy rows via substring filtering; the retrieved text is injected verbatim into a zero-temperature Gemini prompt that is forced (via a typed JSON schema) to produce a determination (`APPROVED`/`ACTION_REQUIRED`/`REJECTED`), a match score, an itemized checklist with exact clause citations and verbatim quotes, missing-requirements, and a justification letter. The architecture enforces zero-hallucination by severing policy evidence from model knowledge and from image-derived descriptions.

---

## 2. Complete Technology Stack

| Layer | Technology | Purpose | Where Used |
| ----- | ---------- | ------- | ---------- |
| Frontend framework | **Next.js 16.3.1** (App Router, React 19.2.8) | Server-rendered app shell + API routes | `app/`, `package.json` |
| UI | **React 19** + **Tailwind CSS 4** (`@tailwindcss/postcss`) | Component UI and styling | `components/*`, `app/globals.css` |
| Icons | **lucide-react** | UI icons | All components |
| Utility | **clsx**, **tailwind-merge** | Conditional class merging | `components/*` |
| Backend/API layer | Next.js **Route Handlers** (`app/api/**/route.ts`) | All server logic | `app/api/*` |
| Database | **Supabase (PostgreSQL)** via `@supabase/supabase-js` 2.112.3 | Policy knowledge base | `lib/supabase.ts` |
| Authentication | **Not implemented** — no auth code, no middleware, no session logic | — | — |
| Vector search / Embeddings | **Not implemented** — no `vector` columns, no embedding calls, no `pgvector` usage anywhere in the repo | — | — |
| Retrieval mechanism | Supabase **substring filter** `.ilike('payer', '%tag%')` | Payer-based retrieval | `lib/supabase.ts:219` |
| LLM | **Gemini** (`@google/genai` 2.17.1), model cascade: `gemini-3.7-flash` → `gemini-3.6-flash` → `gemini-3.5-flash` (chat also `gemini-1.5-flash`, `gemini-2.0-flash`) | Grounded reasoning + structured JSON output | `app/api/chat/route.ts`, `app/api/prior-auth/analyze/route.ts`, `lib/imageProcessing.ts` |
| OCR | **Gemini Vision** (primary) + **Tesseract.js 7.0.0** (fallback) | Text extraction from PDFs/images | `lib/imageProcessing.ts`, `app/api/policy/upload/route.ts` |
| Image understanding | Gemini multimodal (`inlineData` base64) | Image caption/description | `lib/imageProcessing.ts` |
| File handling | Native `File`/`FormData`, Buffer, zlib (PDF stream inflate) | Policy upload | `app/api/policy/upload/route.ts` |
| Validation | Manual functions (`isCleanText`, `isCleanReadableText`, `isRowClean`, magic-byte detection) | Content + format validation | `lib/imageProcessing.ts`, `app/api/policy/upload/route.ts`, `lib/supabase.ts` |
| Deployment | **Vercel** (auto-deploy from GitHub `salahkhafaga1/prior-ai`, prod domain `prior-ai-five.vercel.app`) | Hosting + serverless functions | Vercel dashboard / git integration |
| Build/tooling | **TypeScript 5** (strict), **ESLint 9** (`eslint-config-next`), `next build`, Tailwind 4 CLI | Static checks, linting, production build | `tsconfig.json`, `eslint.config.mjs`, `package.json` |
| Testing | **No test framework and no test files exist in the repository** (see §16) | — | — |

---

## 3. System Architecture

Reverse-engineered from the repository.

```
                      ┌──────────────────────────────────────────────┐
                      │             BROWSER (React SPA)              │
                      │  app/page.tsx                                │
                      │  ┌─────────────┐  ┌──────────────┐           │
                      │  │ChatWorkspace│  │PolicySidebar │           │
                      │  └──────┬──────┘  └──────┬───────┘           │
                      │         │ fetch()        │ fetch()           │
                      │  ┌──────┴──────┐  ┌──────┴───────┐           │
                      │  │Report View  │  │(print/export)│           │
                      └──┴─────────────┴──┴─────────────┘───────────┘
                                     │  HTTP JSON / FormData
                                     ▼
                      ┌──────────────────────────────────────────────┐
                      │        NEXT.JS ROUTE HANDLERS (server)       │
                      │  /api/chat                 /api/policy/upload │
                      │  /api/prior-auth/analyze  /api/policy/list    │
                      │                           /api/policy/payers  │
                      │                           /api/policy/delete  │
                      └──────────────┬───────────────────────────────┘
                                     │
              ┌──────────────────────┼───────────────────────┐
              ▼                      ▼                       ▼
   ┌───────────────────┐  ┌─────────────────────┐  ┌────────────────────┐
   │  lib/supabase.ts  │  │ lib/imageProcessing │  │  @google/genai     │
   │  (DB access)      │  │ (OCR + understanding)│  │  Gemini API        │
   └─────────┬─────────┘  └─────────┬───────────┘  └─────────┬──────────┘
             │                      │                        │
             ▼                      ▼                        ▼
   ┌───────────────────┐   Tesseract.js (fallback)   Grounded prompt + JSON
   │ Supabase PostgreSQL│   Gemini Vision (primary)   schema enforcement
   │ policy_documents   │                              (temperature 0/0.1)
   └───────────────────┘
```

**Layers in the code:**
- **Frontend** — `app/page.tsx` (composition root), `components/ChatWorkspace.tsx` (main chat), `components/PolicySidebar.tsx` (policy library), `components/PriorAuthReportView.tsx` (printable packet).
- **API routes** — thin HTTP handlers in `app/api/*`.
- **Services** — `lib/supabase.ts` (DB), `lib/imageProcessing.ts` (OCR/vision).
- **AI layer** — Gemini calls, model cascades, system prompts, JSON schemas.
- **Retrieval layer** — `searchPayerPolicies()` in `lib/supabase.ts`.
- **Document processing** — `app/api/policy/upload/route.ts` (native PDF parse → chunking → insert).
- **Response generation** — `app/api/chat/route.ts` (grounded evaluation → `PriorAuthReportData`).

---

## 4. End-to-End Data Flow (normal chat request)

1. **User input** — physician types clinical note + tags payer, e.g. `"...8 weeks radiating pain, positive SLR, 6 weeks PT + NSAIDs. @uhc"`, optionally attaches a file/image. (`components/ChatWorkspace.tsx`)
2. **Frontend state** — `inputPrompt`, `attachedFile`, `attachedImages` (base64 data URLs from `FileReader.readAsDataURL` / `readAsText`), `activePayerTag` — `ChatWorkspace.tsx:66-75`, `handleFileUpload` `ChatWorkspace.tsx:273`.
3. **API request** — `fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message, payer: activePayerTag.replace('@',''), images }) })` — `ChatWorkspace.tsx:160-168`.
4. **Server validation** — empty prompt guard → `EMPTY_PROMPT` (400); missing Gemini key → `MISSING_API_KEY` (500) — `app/api/chat/route.ts:151-184`.
5. **Payer identification** — DB-distinct payers fetched; `@tag` regex match or first available payer fallback — `app/api/chat/route.ts:221-234`.
6. **Policy retrieval** — `searchPayerPolicies(detectedPayer)` → `.ilike('payer', '%tag%')` — `app/api/chat/route.ts:236-271`, `lib/supabase.ts:219`.
7. **Content quality gates** — clean-text filter, min 100 chars, rejects unparsed `%PDF` binary — `app/api/chat/route.ts:273-313`.
8. **Image processing** (if any) — `processClinicalImage()` per image (max 5) — `app/api/chat/route.ts:320-356`.
9. **Prompt construction** — physician note + `[OCR TEXT]`/`[IMAGE DESCRIPTION]` blocks + retrieved `[POLICY DOCUMENT n]` blocks — `app/api/chat/route.ts:358-387`.
10. **LLM** — Gemini cascade with strict JSON schema, temperature 0.1 — `app/api/chat/route.ts:393-425`.
11. **Response parsing** — `JSON.parse(responseText)` with `PARSE_ERROR` fallback — `app/api/chat/route.ts:442-462`.
12. **Frontend rendering** — result card with status, checklist, citations, missing items, letter; `parseJsonResponse` guards non-JSON server errors — `ChatWorkspace.tsx:170-250`.

---

## 5. RAG PIPELINE (most important)

### 5.1 Document ingestion
Policies enter via **PolicySidebar** upload form → `POST /api/policy/upload` (`app/api/policy/upload/route.ts`). The form collects a payer name (free text, e.g. "Aetna") + a file (`.pdf/.txt/.png/.jpg/.jpeg`, ≤50MB) or pasted text. **The payer label is user-typed**, which is why inconsistent labels (e.g. `salah`, `aetna_test`) appear in the database.

### 5.2 OCR
Three-tier extraction in `app/api/policy/upload/route.ts`:
1. **Native PDF text extraction** (`extractLocalPDFText`, lines 79-124): locates `stream…endstream` blocks, inflates with `zlib`, parses `Tj`/`TJ`/hex-string text operators. Fast, free, only works on "text-based" (unscanned) PDFs.
2. **Gemini Vision OCR** (`extractTextWithGemini` in `lib/imageProcessing.ts`): whole-file `inlineData` transcription. Used for scanned PDFs (≤15MB) and images (≤8MB).
3. **Tesseract.js** (`runLocalTesseractOCR`): final fallback only.

### 5.3 Chunking
`chunkDocumentText()` (`app/api/policy/upload/route.ts:160`): splits >100KB text into chunks of `MAX_CHUNK_LENGTH = 100,000` chars with `CHUNK_OVERLAP = 1,000`, cutting at the last `.` or `\n` before the boundary. Each chunk becomes its own database row titled `"<title> (Part i/n)"`.

### 5.4 Embeddings — **NOT USED**
The repository contains **no embeddings**: no `text-embedding-*` calls, no vector column, no `pgvector`, no cosine/similarity code. **State this explicitly to judges.**

### 5.5 Retrieval
- The user query is **not** converted into a vector query. Retrieval is **exact substring filtering** by payer: `supabase.from('policy_documents').select('*').ilike('payer', '%<normalizedPayer>%').order('created_at', {ascending:false})` — `lib/supabase.ts:237-241`.
- **Payer filter**: the only filter. `@uhc` → `%uhc%`. Note this also matches `aetna_test` for `@aetna` (substring semantics).
- **Top-K: not implemented** — all matching rows are returned; a lower-bound sanity check requires `totalContentLength ≥ 100` chars (`app/api/chat/route.ts:298`).
- **Metadata used**: `payer`, `content`, `title`, `procedure_type`, `clause_section` (rendered into the prompt at `app/api/chat/route.ts:358-372`).
- **Ordering**: newest first (`created_at DESC`).

### 5.6 Grounded generation
Retrieved rows are wrapped as `[POLICY DOCUMENT n]` blocks (payer, title, procedure type, clause/section, content) and concatenated into `policyContext` (`app/api/chat/route.ts:359-372`). This is injected verbatim into `fullPrompt` alongside the physician note and any image context (`app/api/chat/route.ts:377-387`).

### 5.7 Citations
Citations are **model-generated but ground-forced**:
- System rule 4: *"For EVERY checklist criterion, you MUST state the EXACT Clause/Section and Verbatim Quote from the uploaded insurance policy."* (`STRICT_SYSTEM_INSTRUCTION`, `app/api/chat/route.ts:35-64`).
- The JSON schema requires `sectionClause`, `exactPolicyQuote`, `patientEvidence` per checklist item.
- **Image descriptions are explicitly excluded from policy evidence**: system rule 8 says policy citations must come EXCLUSIVELY from retrieved policy documents (`app/api/chat/route.ts:61-64`).
- The final report (`components/PriorAuthReportView.tsx`) renders the verbatim quote under each requirement.

> **Example flow:** User question → payer tag → ILIKE filter → policy chunks → grounded prompt → Gemini (temp 0.1, JSON schema) → answer with `sectionClause` + `exactPolicyQuote` per criterion.

---

## 6. POLICY DOCUMENT PROCESSING

Pipeline (`app/api/policy/upload/route.ts`):

```
File Upload (multipart FormData: payer + file)
  → size check (≤50MB → 413)
  → extension routing (.pdf/.png/.jpg/.jpeg/.txt/.md/.csv or pasted content)
  → PDF: native extractLocalPDFText → isCleanReadableText?
        ├─ yes → content
        └─ no  → Gemini Vision OCR (≤15MB) → clean? | Tesseract fallback → clean?
  → isCleanReadableText(content) final gate (min 80 chars, ≥15 words, ≥35% alphabetic,
    rejects %PDF/endstream/startxref//filter)
  → chunkDocumentText (100KB / 1KB overlap)
  → storePolicyDocument(chunk) per chunk → Supabase INSERT
  → response { success, payer, textLength, chunksStored, ocrUsed }
```

**What is stored in the database:** only **extracted text + metadata** — `payer`, `title`, `procedure_type`, `clause_section`, `content`, `created_at`. **The original PDF/image is NOT stored** — no storage bucket, no raw-file column exists in the code. This is a deliberate privacy-friendly decision but means the source file cannot be re-extracted later without re-upload.

Key functions: `extractLocalPDFText` (79), `isCleanReadableText` (129), `chunkDocumentText` (160), `storePolicyDocument` (`lib/supabase.ts:274`).

---

## 7. IMAGE UNDERSTANDING PIPELINE

All in `lib/imageProcessing.ts` + `types/imageProcessing.ts`.

### 7.1 Supported images
- MIME types: `image/png`, `image/jpeg`, `image/webp` (`SUPPORTED_IMAGE_MIME_TYPES`, line 9).
- **Size limit:** 8 MB per image (`MAX_IMAGE_SIZE_BYTES`), enforced at `processClinicalImage` line 222 and uploaded at `MAX_IMAGES_PER_REQUEST = 5` (`app/api/chat/route.ts:321`).
- **Magic-byte validation** (`detectImageFormat`, line 73): verifies actual byte signatures for PNG (0x89 PNG…), JPEG (0xFFD8), WEBP (RIFF…WEBP) before any decoding — prevents corrupt data from crashing the Tesseract worker.

### 7.2 OCR stage
- **Primary:** Gemini Vision (`extractTextWithGemini`) — fast, serverless-safe.
- **Fallback:** Tesseract.js (`runLocalTesseractOCR`, line 104) — lazy-imported worker, `createWorker('eng')`.
- **WEBP:** OCR is skipped (Tesseract.js WebP decoding is unreliable → worker-crash risk); only image understanding runs.
- **Status model** (`types/imageProcessing.ts`): `OCR_SUCCESS` / `OCR_PARTIAL` (< `OCR_MIN_TEXT_LENGTH`=20 chars) / `OCR_FAILED`, each with an optional `{phase:'ocr', message}` error.
- **Failure handling:** any OCR failure is captured, not thrown; the stage degrades independently.

### 7.3 Image understanding stage
- `generateImageCaption` (line 137): Gemini multimodal call via `@google/genai`.
- Request: `contents: [{ inlineData: { mimeType, data: base64 } }, { text: 'Analyze this medical-related image…' }]`, `CAPTION_SYSTEM_INSTRUCTION`, temperature 0.2, `responseMimeType: 'application/json'`, `CAPTION_JSON_SCHEMA`.
- Output: `{ imageType, description, visibleTextSummary, confidence: low|medium|high }`.
- Status: `CAPTION_SUCCESS` / `CAPTION_FAILED`.

### 7.4 Separation of information — `[OCR TEXT]` vs `[IMAGE DESCRIPTION]`
In the chat prompt (`app/api/chat/route.ts:335-356`), each attachment is rendered with distinct labels:
- `[OCR TEXT]` — extracted document text (treated as patient-clinical context, like a pasted chart note).
- `[IMAGE DESCRIPTION]` — AI visual interpretation (explicitly *not* authoritative).

This separation is critical because OCR text is a transcription of a real document, whereas a caption is the model's interpretation. System rule 7/8 (`app/api/chat/route.ts:61-64`) therefore forbid using image *descriptions* as policy evidence; policy citations may only come from retrieved policy documents.

---

## 8. IMAGE → RAG INTEGRATION

Full trace (all in `components/ChatWorkspace.tsx` + `app/api/chat/route.ts`):

```
Image file
  → FileReader.readAsDataURL → data URL  (ChatWorkspace.tsx:280-293)
  → stored in React state as attachedImages [{name, mimeType, dataUrl, sizeBytes}]
  → attached previews rendered (ChatWorkspace.tsx:768)
  → handleSend strips "data:...;base64," → base64 in images payload (ChatWorkspace.tsx:132-137)
  → POST /api/chat (ChatWorkspace.tsx:160)
  → rawImages.slice(0,5)  (chat/route.ts:321)
  → processClinicalImage(img)  (chat/route.ts:330-333, lib/imageProcessing.ts:200)
      ├─ magic-byte check → buffer decode → OCR → caption
      └─ returns ProcessedImageAttachment (never throws)
  → attachmentContext: [IMAGE n: name (mime)] + [OCR TEXT] + [IMAGE DESCRIPTION]
      (chat/route.ts:336-356)
  → appended to fullPrompt + retrieved policy context
  → Gemini evaluation (JSON schema)
  → response.attachments returned (chat/route.ts:469)
  → UI renders "Attached Image Processing" panel with SUCCESS/PARTIAL/FAILED badges,
      collapsible OCR text + image understanding (ChatWorkspace.tsx:611-668)
```

**Persistence of image content:** **nowhere.** Images travel as base64 in the HTTP request, are processed in-memory server-side, returned in the response, and discarded. **They are not persisted, not embedded, not stored in Supabase** (no bucket, no table, no function writes them). They are used only for the current request. (Verified: no storage code exists anywhere in the repo.)

---

## 9. GEMINI / LLM INTEGRATION

- **SDK:** `@google/genai` (`new GoogleGenAI({ apiKey })`).
- **Models (cascade):** chat → `gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash, gemini-1.5-flash, gemini-2.0-flash` (`app/api/chat/route.ts:8-14`); analyze → `gemini-3.7/3.6/3.5-flash`; vision/OCR → `gemini-3.6/3.5/2.5-flash`. On failure the loop sleeps 1s and tries the next model (cascade resilience).
- **System instruction:** `STRICT_SYSTEM_INSTRUCTION` (chat) — grounding rules, vague-input refusal, citation format, JSON contract.
- **User prompt:** physician note + image context + `RETRIEVED INSURANCE POLICY GROUND TRUTH`.
- **Output format:** `responseMimeType: 'application/json'` + **typed `responseSchema`** (`STRICT_JSON_SCHEMA`) → schema-enforced JSON, no free-form output.
- **Temperature:** 0.1 (chat), 0 (OCR), 0.2 (caption) — low-temperature for determinism.
- **Error handling:** per-model try/catch; `GEMINI_CASCADE_FAILED` if all fail; `PARSE_ERROR` if `JSON.parse` fails.
- **API key handling:** `process.env.GEMINI_API_KEY || GOOGLE_GENAI_API_KEY || NEXT_PUBLIC_GEMINI_API_KEY`; guarded (`MISSING_API_KEY`, `your_actual_gemini_api_key_here` sentinel). Key never logged.

**Why LLM for reasoning, not as source of truth:** the model is a *reasoning engine* over retrieved evidence. It cannot invent coverage rules because (a) rules must come from the injected policy text, (b) every criterion must cite a clause + verbatim quote, and (c) output is schema-constrained. Policy truth lives in Supabase; the LLM only interprets it.

---

## 10. SUPABASE / DATABASE ARCHITECTURE

- **Client:** `@supabase/supabase-js`, `createClient(url, anonKey, { auth: { persistSession: false } })` — `lib/supabase.ts:44`.
- **Schema:** inferred from code. **One table, no joins, no SQL files in the repo**:

```
policy_documents
├── id            uuid (PK, default)        — generated by Supabase
├── payer         text                       — free-text label (e.g. "uhc", "aetna")
├── title         text                       — document title, "(Part i/n)" suffix on multi-chunk
├── procedure_type text                      — e.g. "General Policy"
├── clause_section text                      — e.g. "Section 1.0 - Coverage Criteria"
├── content       text                       — extracted policy text (the retrieval payload)
└── created_at    timestamptz                — used for ordering (DESC)
```

- **No vector column, no RPC functions, no indexes defined in code.**
- **Operations:** `SELECT` (`fetchAllPolicies`, `fetchAvailablePayers`, `searchPayerPolicies`), `INSERT` (`storePolicyDocument`), `DELETE` (`deletePolicyDocument`). **No UPDATE call exists in the repo.**
- **RLS policies: not defined in the repository** (no SQL/migration files). **Runtime observation during deployment:** with the anon key, `SELECT` and `INSERT` succeed, but `UPDATE` and `DELETE` affected **0 rows** (HTTP 200/204, empty payloads) — i.e. the anon role lacks UPDATE/DELETE policies on the deployed table. Consequence: the app's delete feature can silently no-op (§14, §15).
- **Persistence:** policy text/metadata is persistent; conversations, images, and user notes are **not** stored (§8).

---

## 11. API ARCHITECTURE

| Route | Method | Input | DB | AI | Errors |
| ----- | ------ | ----- | -- | -- | ------ |
| `/api/chat` | POST | `{message?, payer?, images?}` | payer list + `searchPayerPolicies` | Gemini cascade + OCR | `EMPTY_PROMPT`, `MISSING_API_KEY`, `NO_PAYERS_IN_DATABASE`, `NO_PAYER_MATCH`, `UNPARSED_PDF_STREAM`, `EMPTY_POLICY_CONTENT`, `GEMINI_CASCADE_FAILED`, `PARSE_ERROR`, `UNHANDLED_EXCEPTION`; `maxDuration=60`, `dynamic='force-dynamic'` |
| `/api/prior-auth/analyze` | POST | `{patientNote, payerId, procedureRequested?}` | none (no retrieval!) | Gemini (3-model cascade) → mock fallback | 400 invalid body, `Mock-Fallback-OnError` via headers; `maxDuration=60` |
| `/api/policy/upload` | POST | multipart `payer` + `file` / `content` | `storePolicyDocument` (INSERT per chunk) | native PDF / Gemini OCR / Tesseract | 400 missing payer, 413 >50MB, 422 unreadable text, 500 insert failure; `maxDuration=60` |
| `/api/policy/list` | GET | — | `fetchAllPolicies` | — | `SUPABASE_FETCH_FAILED`/`LIST_EXCEPTION` → 500 |
| `/api/policy/payers` | GET | — | `fetchAvailablePayers` | — | `SUPABASE_PAYER_QUERY_FAILED`/`PAYERS_EXCEPTION` → 500 |
| `/api/policy/delete` | POST | `{id}` | `deletePolicyDocument` | — | 400 no id; **bug:** `if (!success)` where `success` is always a truthy object → never reports failure (§14) |

**Important honesty note:** `/api/prior-auth/analyze` does **not** perform retrieval and falls back to mock keyword heuristics (`getFallbackResponse` in `app/api/prior-auth/analyze/route.ts:189`) when the API key is absent or the Gemini call fails. The **production chat path is `/api/chat`** — it is the only route with RAG retrieval. The analyze route and its UI components (`PatientInputForm`, `Header`, `AnalysisResultView`) are **not imported by `app/page.tsx`** (legacy/secondary flow).

---

## 12. FRONTEND ARCHITECTURE

- **`app/page.tsx`** — composition root: owns `isPolicySidebarOpen`, `activeReport`, `activePayerTag`, `payersRefreshKey`; renders `PolicySidebar` + `ChatWorkspace` + `PriorAuthReportView`.
- **`components/ChatWorkspace.tsx`** (850 lines) — the core UI:
  - **Chat state:** `messages: ChatMessage[]` (role, content, `reportData`, `attachments`, `errorInfo`); `inputPrompt`; `isLoading`.
  - **Attachment state:** `attachedFile` (text), `attachedImages` (data URLs); `FileReader` loaders at `handleFileUpload` (line 273).
  - **Request construction:** `handleSend` (line 124) → strips base64 header, sends `{message, payer, images}`; wraps `res.json()` with `parseJsonResponse` (content-type guard, line 25).
  - **Response rendering:** status strip, summary, missing-requirements box, checklist w/ clause+quote, "Attached Image Processing" panel (`SUCCESS/PARTIAL/FAILED`), "View Official Packet"/"Export PDF" triggers.
  - **Error handling:** structured `DiagnosticErrorInfo` banners with copyable log + expandable details; contextual CTA for `NO_PAYER_MATCH`/`NO_PAYERS_IN_DATABASE`; non-JSON server responses surfaced as clean messages.
- **`components/PolicySidebar.tsx`** — policy library: list (searchable), upload form (payer + file/paste), delete, payer-tag shortcuts; hardened JSON parsing on upload (content-type guard).
- **`components/PriorAuthReportView.tsx`** — printable/copyable official packet: letterhead, determination banner, missing items, checklist table (requirement/status/clause+quote/chart-evidence), justification letter, signature block; PDF export via `window.print()` + `@media print` CSS (`.no-print` toolbar hidden).
- **`components/Header.tsx`, `PatientInputForm.tsx`, `AnalysisResultView.tsx`** — **legacy/unwired** (not referenced from `app/page.tsx`); they drive the `/api/prior-auth/analyze` mock-heavy flow.

---

## 13. CLINICAL SAFETY / AI SAFETY (implemented)

| Safeguard | Where |
| --------- | ----- |
| Policy evidence is the **only** allowed coverage source | `STRICT_SYSTEM_INSTRUCTION` rule 1 (`app/api/chat/route.ts:39`) |
| **Vague/missing clinical input → refusal** to generate a letter, polite request for symptoms/treatments/payer, `matchScore:0, status:ACTION_REQUIRED` | rule 2 (`app/api/chat/route.ts:40`) |
| **Exact clause + verbatim quote required per criterion** | rule 4 + JSON schema (`sectionClause`/`exactPolicyQuote`) |
| **Image descriptions ≠ evidence** | rules 7–8 (`app/api/chat/route.ts:61-64`) |
| **No fabricated policy text**: unparsed/binary stored rows are rejected at retrieval (`UNPARSED_PDF_STREAM`, `EMPTY_POLICY_CONTENT`) | `app/api/chat/route.ts:273-313` |
| Schema-enforced output (`application/json`) | `responseSchema` |
| Low temperature (0.1) for determinism | chat route config |
| Missing-information reporting surfaces to the user (missing-requirements list) | `ChatWorkspace.tsx:553` |
| Graceful failure instead of hallucination when Gemini fails | cascade + explicit error codes |
| Clinical notes are transient (in-memory, per request) | §8 |

**Recommendations (not implemented):** clinician-in-the-loop sign-off, structured medical-legal disclaimer, audit trail, HIPAA-grade logging redaction, tests that verify citation fidelity.

---

## 14. ERROR HANDLING & RESILIENCE

- **API/network:** frontend `parseJsonResponse` detects non-JSON (HTML/504) responses and shows a human-readable message (added in `ChatWorkspace.tsx`/`PolicySidebar.tsx`).
- **Invalid files:** size cap 50MB → 413; missing payer → 400; unreadable text → 422.
- **Invalid image formats:** MIME whitelist + **magic-byte** detection → clear error, never a worker crash.
- **OCR failures:** Gemini→Tesseract fallback; independent per-stage failure with `phase` error info.
- **Gemini failures:** model cascade (1s sleep between); `GEMINI_CASCADE_FAILED`; analyze route falls back to mock response with `X-Data-Source: Mock-Fallback-OnError`.
- **Supabase failures:** typed `DiagnosticError` contract (`SUPABASE_*` codes) returned with HTTP statuses.
- **Missing env:** `SUPABASE_UNCONFIGURED`, `MISSING_API_KEY` explicit errors.
- **Malformed/empty input:** `EMPTY_PROMPT` (400); JSON body parse handled.
- **Status model:** images → `SUCCESS`/`PARTIAL`/`FAILED` (each of OCR + caption independently); whole-request → structured success/error JSON.
- **Known defect:** `/api/policy/delete` returns success even when the DB delete no-ops because `if (!success)` tests a truthy object, and `deletePolicyDocument`'s `error` field is ignored by the route (`app/api/policy/delete/route.ts:11-16`). Combined with the observed RLS block on `DELETE`, deletions can silently fail.

---

## 15. SECURITY & PRIVACY

- **API keys:** `GEMINI_API_KEY` read server-side only; Supabase URL/anon key are `NEXT_PUBLIC_*` (necessarily visible to the client — this is the normal Supabase pattern, but see RLS note). Keys are never logged; base64 image payloads are explicitly documented as "never include in logs" (`types/imageProcessing.ts:14`).
- **Environment:** `.env.local` (gitignored); secrets are set on Vercel. `GEMINI_API_KEY` sentinel `your_actual_gemini_api_key_here` is treated as missing.
- **Authentication/Authorization:** **none implemented.** Any client can call `/api/*` with the anon key. There is no user/login layer.
- **Supabase RLS:** **not defined in the repo.** Deployed observation: anon can SELECT+INSERT, but UPDATE/DELETE affect 0 rows → read/write semantics are unmanaged by the codebase and depend entirely on dashboard-configured policies.
- **Input validation:** size/MIME/cleanliness/magic-byte checks exist; there is **no explicit PII redaction** and **no rate limiting**.
- **Logging:** `console.log/error` with structured prefixes and timestamps (no PII redaction); no remote logging configured.
- **Data exposure:** patient notes and images are in-memory and per-request (not persisted); policy text is persisted in Supabase. The app is a **single-tenant** deployment — adequate for a demo, insufficient for multi-tenant healthcare use without auth + RLS + audit.

---

## 16. TESTING & VERIFICATION

**In-repo test tooling:** none. `package.json` scripts are only `dev`, `build`, `start`, `lint`. No `*.test.*`, no `*.spec.*`, no `jest`/`vitest`/`playwright`, no CI config.

**Verification performed during development/deployment (this session, not committed):**
- `npx tsc --noEmit` → passes (strict mode).
- `npm run lint` → reports **pre-existing** `@typescript-eslint/no-explicit-any` errors (28+, in routes/legacy components); my changes added none.
- `npm run build` → passes; routes listed: `/`, `/_not-found`, `/api/chat`, `/api/policy/delete`, `/api/policy/list`, `/api/policy/payers`, `/api/policy/upload`, `/api/prior-auth/analyze`.
- Runtime smoke tests (production): `/api/policy/list` → 200 with real Supabase rows; `/api/chat` with `@uhc` → `SUCCESS=true`, `status=ACTION_REQUIRED`, model `gemini-3.7-flash`, justification letter generated; `/api/policy/upload` with a generated text-PNG → 200, `ocrUsed:true`, 154 chars extracted (Gemini OCR path); Gemini `/v1beta/models` → 50 models (key valid).
- Earlier dev tests: OCR on a real PNG returned `OCR_SUCCESS`; malformed data produced `OCR_FAILED` gracefully; no Tesseract worker crash (magic-byte guard).

**Test gaps:** no automated unit/integration/e2e tests; no citation-fidelity eval; no prompt-injection tests; no load tests; no hallucination benchmark.

---

## 17. PERFORMANCE (qualitative — no fabricated benchmarks)

- **OCR latency:** Gemini Vision ~seconds; the only local measurement this session was a single small-PDF `generateContent` at ~25s wall-clock (one-off, not a benchmark). Tesseract.js on cold start must load WASM + `eng.traineddata` (~15MB) → the reason it was demoted to fallback.
- **Gemini latency:** dominated the request; cascade can add up to ~4×1s sleeps on failures.
- **Limits:** ≤5 images/request, ≤8MB/image, ≤50MB upload, ≤100KB chunk.
- **Retrieval complexity:** O(n) filter over the payer column — fine at small scale, no index guarantee, no top-K.
- **DB calls per chat:** 1 (payers) + 1 (policy search); the payers query is `select * order by payer` (fetches all rows server-side to derive distinct values — inefficient at scale).
- **Serverless constraints:** Hobby `maxDuration=60s` on chat/upload/analyze; large OCR/PDFs can still approach the cap.
- **Concurrency:** no queueing; each request spawns its own model cascade + OCR; parallel requests could hit Gemini rate limits.

---

## 18. CURRENT LIMITATIONS

### Implemented limitations
- Retrieval is **substring-by-payer only** (no semantic/vector search, no top-K, no cross-payer ranking).
- `/api/prior-auth/analyze` is **mock-fallback driven**, not RAG.
- Original PDFs/images are not stored.
- Delete/Update are blocked by the deployed RLS (observed) and delete errors are swallowed by the route.
- Legacy components (`Header`, `PatientInputForm`, `AnalysisResultView`) are unwired dead-ish code.
- README.md is the default `create-next-app` boilerplate (no project docs).

### Known bugs
- `/api/policy/delete` reports success regardless of actual deletion (`app/api/policy/delete/route.ts:11-16`).
- Payer matching is substring-based → `@aetna` can match `aetna_test`.
- Free-text payer labels cause duplicate/mislabeled rows (observed: `salah`, `test`, `aetna_test` rows in the deployed DB; one genuine `uhc` row).
- Pre-existing `no-explicit-any` lint debt.

### Production risks
- No auth/RBAC/RLS-in-repo + anon key client-visible ⇒ multi-tenant exposure.
- No rate limiting; no observability/alerting; no audit trail.
- Serverless 60s timeout near-limit for big OCR jobs.
- PII in logs; no redaction; no remote logging.

### Future improvements
- `pgvector` semantic retrieval + hybrid search + top-K re-ranking.
- RLS policies + Supabase Auth + per-tenant separation.
- Store original PDFs in Supabase Storage with signed URLs.
- Evaluation harness (citation-fidelity, hallucination score, golden set).
- Automated tests + CI; rate limiting; structured logging with PII redaction.

---

## 19. IMPORTANT ARCHITECTURAL DECISIONS

1. **OCR + image-understanding separation** — *Why:* transcription (factual) vs. interpretation (uncertain) are epistemically different. *Benefit:* prompt can restrict what counts as evidence. *Trade-off:* two model calls per image (cost/latency).
2. **Gemini Vision OCR first, Tesseract last** — *Why:* serverless timeouts (Hobby 60s) made Tesseract unreliable on cold start. *Benefit:* uploads finish in seconds. *Trade-off:* adds Gemini cost; native PDF parse kept for free fast path.
3. **Shared OCR utility** across upload and chat (`runLocalTesseractOCR`/`extractTextWithGemini`) — *Why:* one validated code path. *Benefit:* single maintenance point. *Trade-off:* chat now also depends on Gemini for images.
4. **Policy-evidence separation (`[OCR TEXT]` vs `[IMAGE DESCRIPTION]`, rules 7–8)** — *Why:* zero-hallucination. *Benefit:* citations can't come from image interpretation. *Trade-off:* model can't use "seen in image" reasoning for coverage.
5. **Supabase persistence of extracted text only** — *Why:* fast retrieval, privacy-friendly, simple. *Benefit:* no blob storage needed. *Trade-off:* can't re-OCR later; original file lost.
6. **Payer-tag-driven ILIKE retrieval instead of embeddings** — *Why:* zero setup, deterministic, explainable. *Benefit:* judge-able correctness, no embedding infra. *Trade-off:* no semantic recall; substring false-positives.
7. **Gemini multimodal inlineData** — *Why:* one SDK, one vendor, vision+text together. *Benefit:* no extra vision service. *Trade-off:* vendor lock-in + payload size limits.
8. **Graceful degradation + diagnostic error contract** — *Why:* demo-grade reliability and debuggability. *Benefit:* users see actionable codes, not stack traces. *Trade-off:* more code paths to maintain.
9. **Magic-byte validation** — *Why:* corrupt/WebP input crashed the Tesseract worker. *Benefit:* no worker crashes, clean error UX. *Trade-off:* extra bytes scan.
10. **Additive API response contract** (`attachments` appended to chat response) — *Why:* backwards compatibility with existing result rendering. *Benefit:* image feature shipped without breaking the report UI. *Trade-off:* polymorphic payload is less typed.

---

## 20. "How I Would Explain This Project to a Technical Judge"

> "This is MEDAI — a prior-authorization copilot built on a strict retrieval-augmented-generation pipeline. The problem: prior auth requires matching a patient chart against dense, insurer-specific policy bulletins, which is slow and error-prone by hand. My solution never lets the AI answer from memory. Instead, the physician pastes a clinical note, tags a payer with `@uhc`, and the system retrieves that payer's policy text from Supabase, injects it verbatim into a zero-temperature Gemini prompt with a forced JSON schema, and produces a determination — APPROVED, ACTION_REQUIRED, or REJECTED — a match score, and an itemized checklist where every criterion cites the exact policy clause and a verbatim quote. It also writes a physician-ready justification letter.
>
> Policies get in through an ingestion pipeline: native PDF text extraction first (fast, free), then Gemini Vision OCR for scanned files, then Tesseract.js as a last resort — text is cleaned, chunked at 100KB with overlap, and stored in Supabase. No embeddings — retrieval is a deterministic payer filter, which keeps every answer explainable.
>
> Physicians can also attach images. The system separates OCR text — a transcription, treated as patient context — from AI image descriptions — interpretation, explicitly forbidden from being used as policy evidence. That's the core safety story: policy truth lives in the database, the LLM only reasons over retrieved evidence, and if the model's uncertain or the clinical detail is missing, it refuses to fabricate a letter and asks for the missing data.
>
> The architecture is a Next.js 16 app with route handlers as the API layer, Supabase as the knowledge base, and a Gemini model cascade with schema-enforced JSON and graceful degradation — every failure returns a structured diagnostic code rather than a crash. It's deployed on Vercel with environment-separated config. The main trade-off I made: I chose deterministic retrieval and provable grounding over semantic search, and I'd extend it with vector retrieval, RLS-secured auth, and an evaluation harness for citation fidelity as the next steps."

---

## 21. TECHNICAL Q&A FOR JUDGES

### Q1. Why RAG instead of fine-tuning?
- **Short:** Fine-tuning bakes facts into weights (stale, unverifiable, per-payer). RAG keeps policy truth in a database and only reasons over retrieved evidence.
- **Deep:** The coverage criteria change per payer and per year. Fine-tuning would require retraining per policy update and offers no way to prove where a rule came from. RAG lets us cite exact clauses and verbatim quotes, making each verdict auditable; the LLM stays a reasoning engine (`app/api/chat/route.ts`).
- **Files:** `app/api/chat/route.ts`, `lib/supabase.ts`.

### Q2. Why this LLM (Gemini)?
- **Short:** One SDK (`@google/genai`) gives vision, OCR, PDF ingestion, and structured JSON in a single vendor.
- **Deep:** The app needs multimodal (text + inlineData images/PDFs) with schema-enforced output (`responseSchema`). Gemini flash-tier models give the latency/cost profile for a cascade that can also fall back across model versions. No other stack component is needed.
- **Files:** `lib/imageProcessing.ts`, `app/api/chat/route.ts`.

### Q3. Why Supabase?
- **Short:** Hosted Postgres with a JS SDK, zero-infra, and SQL-compatible schema for future vector search.
- **Deep:** `policy_documents` is a single table with text + metadata; Supabase gives direct `select/insert/delete` via `@supabase/supabase-js`, and `pgvector` is a future upgrade path without changing vendors. Anon key keeps client calls simple (no auth yet).
- **Files:** `lib/supabase.ts`.

### Q4. How does retrieval work?
- **Short:** ILIKE substring match on the `payer` column — no vectors.
- **Deep:** `searchPayerPolicies(tag)` normalizes the tag, runs `.ilike('payer', '%tag%')` ordered newest-first, returns all matching rows; the chat route then applies clean-text filters and a ≥100-char sanity gate. Deterministic and explainable.
- **Files:** `lib/supabase.ts:219`, `app/api/chat/route.ts:236-313`.

### Q5. How do you prevent hallucinations?
- **Short:** The model may only use retrieved policy text; every criterion requires a clause + verbatim quote; output is schema-forced; refusal when input is vague.
- **Deep:** System rule 1 forbids fabricating coverage rules; rule 4 forces per-item citations; `responseMimeType:'application/json'` + `responseSchema` constrains shape; temperature 0.1; unparsed/empty policy rows are rejected before prompting.
- **Files:** `app/api/chat/route.ts:35-137`.

### Q6. How are citations generated?
- **Short:** By the model from the injected policy text, under instruction + schema, then rendered in the report.
- **Deep:** The prompt embeds `[POLICY DOCUMENT n]` blocks; the schema requires `sectionClause` and `exactPolicyQuote` per checklist item; the UI renders them (`ChatWorkspace.tsx`, `PriorAuthReportView.tsx`).
- **Files:** `app/api/chat/route.ts:358-372`, `components/PriorAuthReportView.tsx`.

### Q7. How do you handle missing clinical data?
- **Short:** The engine refuses to fabricate and asks for the missing specifics.
- **Deep:** Rule 2: if input is vague, it replies with a request for symptom duration, treatments, and `@PayerName`, sets `matchScore:0`, `status:'ACTION_REQUIRED'`. Partial cases surface `missingRequirements` to the user.
- **Files:** `app/api/chat/route.ts:40`, `ChatWorkspace.tsx:553`.

### Q8. Why OCR?
- **Short:** Policy PDFs are often scanned images with no embedded text.
- **Deep:** Native PDF text operators don't exist in scanned files; OCR converts pixel content to text so it can be stored, chunked, and retrieved. Gemini Vision (fast) with Tesseract fallback.
- **Files:** `app/api/policy/upload/route.ts`, `lib/imageProcessing.ts`.

### Q9. Why image understanding (captioning) on top of OCR?
- **Short:** OCR gives raw text; captions give context for non-text visuals (tables, charts).
- **Deep:** `generateImageCaption` produces `imageType`/`description`/`visibleTextSummary`/`confidence` — used as descriptive patient context, explicitly not evidence.
- **Files:** `lib/imageProcessing.ts:137`.

### Q10. OCR vs image understanding — why keep them separate?
- **Short:** One is transcription (reliable), the other interpretation (uncertain).
- **Deep:** The prompt separates `[OCR TEXT]` from `[IMAGE DESCRIPTION]` and rule 8 forbids using descriptions for policy citations — this keeps grounded evidence clean.
- **Files:** `app/api/chat/route.ts:335-356`, `app/api/chat/route.ts:61-64`.

### Q11. What happens if OCR fails?
- **Short:** The stage degrades independently; image understanding still runs, and the UI shows `OCR_FAILED` with a reason.
- **Deep:** `processClinicalImage` never throws; it returns a `ProcessedImageAttachment` with `ocrStatus` and a `{phase, message}` error. `PARTIAL`/`FAILED` statuses render in the attachment panel.
- **Files:** `lib/imageProcessing.ts:200-311`, `ChatWorkspace.tsx:611-668`.

### Q12. What happens if Gemini fails?
- **Short:** Model cascade, then explicit `GEMINI_CASCADE_FAILED`; the analyze route additionally falls back to a mock response.
- **Deep:** The chat tries up to 5 models with 1s sleeps; on total failure it returns a structured 500. The analyze route returns `getFallbackResponse` with `X-Data-Source: Mock-Fallback-OnError`.
- **Files:** `app/api/chat/route.ts:393-440`, `app/api/prior-auth/analyze/route.ts:170-178`.

### Q13. What happens if the image is corrupted?
- **Short:** Magic-byte validation rejects it before processing; no worker crash.
- **Deep:** `detectImageFormat` checks real byte signatures (PNG/JPEG/WEBP); mismatches return `OCR_FAILED` with a decode error. WebP skips OCR to avoid Tesseract crashes.
- **Files:** `lib/imageProcessing.ts:73-98`, `lib/imageProcessing.ts:243-250`.

### Q14. How do you protect policy-grounding integrity?
- **Short:** Stored rows are validated for clean text; binary/unparsed rows are rejected at retrieval.
- **Deep:** `isCleanText` (chat) rejects `%PDF`, `endstream`, `startxref`, `/<filter>` and requires ≥80 chars; the route returns `UNPARSED_PDF_STREAM`/`EMPTY_POLICY_CONTENT` (422) instead of prompting with garbage.
- **Files:** `app/api/chat/route.ts:18-33, 273-313`.

### Q15. How is patient context separated from policy evidence?
- **Short:** Different prompt sections + rules that forbid mixing.
- **Deep:** The prompt has three labeled regions: physician note, image attachment blocks, and `RETRIEVED INSURANCE POLICY GROUND TRUTH`; rules 1 & 8 restrict citations to the last region.
- **Files:** `app/api/chat/route.ts:377-387`.

### Q16. What happens with multiple images?
- **Short:** Up to 5, processed sequentially, each independently.
- **Deep:** `images.slice(0, MAX_IMAGES_PER_REQUEST)`; each goes through `processClinicalImage`; per-image status/error shown. Larger batches would hit the 60s serverless cap.
- **Files:** `app/api/chat/route.ts:321`, `lib/imageProcessing.ts`.

### Q17. How scalable is the architecture?
- **Short:** Fine for a single-tenant demo; needs auth/RLS and vector search for real scale.
- **Deep:** Serverless + stateless functions scale horizontally, but retrieval is O(n) substring over the payer column, payers query fetches all rows, and no caching/queueing exists. Next steps: pgvector, indexes, auth.
- **Files:** `lib/supabase.ts`.

### Q18. What are the main bottlenecks?
- **Short:** LLM latency, OCR on cold starts, 60s serverless cap, and full-row payer queries.
- **Deep:** Model cascade can add seconds; Tesseract cold start loads ~15MB traineddata; `fetchAvailablePayers` selects all rows to compute distinct values.
- **Files:** `lib/supabase.ts:157`, `app/api/chat/route.ts:8-14`.

### Q19. How would you deploy this in production?
- **Short:** It already deploys to Vercel from GitHub; production hardening means auth, RLS, logging, quotas.
- **Deep:** Currently: auto-deploy on `main`, env vars set per environment, `maxDuration=60`. Production: Supabase Auth + RLS, rate limiting, structured logs, audit trail, key rotation.
- **Files:** (Vercel config via dashboard; route `maxDuration` exports.)

### Q20. How would you improve retrieval?
- **Short:** Add pgvector embeddings + hybrid keyword/vector search + top-K re-ranking.
- **Deep:** Embed each chunk with a text-embedding model, store in a `vector` column, combine `ILIKE` payer filter with cosine similarity, return top-K with metadata. This preserves determinism while adding semantic recall.
- **Files:** (proposed change to `lib/supabase.ts:219`.)

### Q21. How would you evaluate RAG quality?
- **Short:** Golden-set: known clinical notes × expected verdicts, measure verdict/match accuracy and citation fidelity.
- **Deep:** Metrics: exact-match of status, score RMSE, % checklist rows whose `exactPolicyQuote` is a substring of the retrieved policy, missing-requirement recall. Manual physician review for clinical validity.
- **Files:** (not implemented — proposed.)

### Q22. How would you evaluate hallucination?
- **Short:** Verify every quote against the source policy and every claim against the note.
- **Deep:** Programmatic check: is `exactPolicyQuote` contained in the retrieved chunk? Is `patientEvidence` grounded in the note/image OCR? Count fabrications. This can be a CI eval over the golden set.
- **Files:** (not implemented — proposed.)

### Q23. What are the privacy concerns?
- **Short:** No auth, anon key in client, PII in plain logs, no audit.
- **Deep:** Patient notes/images are ephemeral (never stored), but logs `console.log` them in plaintext server-side; the anon key is exposed to the browser; single-tenant means any visitor sees the same data. Need Supabase Auth + RLS + redaction.
- **Files:** `lib/supabase.ts:15-35`.

### Q24. What is the biggest weakness of the current system?
- **Short:** Retrieval is a single-substring filter — no semantic search — and there is no auth/RLS in the repo.
- **Deep:** A physician wording a payer differently (`@UnitedHealthcare` vs stored `uhc`) gets `NO_PAYER_MATCH`; without RLS/auth the API is open. Both are mitigable, but they're the most impactful gaps.
- **Files:** `lib/supabase.ts:219`, `app/api/chat/route.ts:256-271`.

### Q25. Why no fine-tuning at all?
- **Short:** Grounding beats memorization for auditable medical decisions.
- **Deep:** Even a fine-tuned model can't guarantee citations; RAG guarantees every rule has a retrievable source. Fine-tuning could still improve JSON reliability, but adds training infra.
- **Files:** `app/api/chat/route.ts`.

### Q26. How do you ensure the letter is physician-ready?
- **Short:** Schema requires it; UI treats it as an official printable packet.
- **Deep:** `justificationLetter` is a required JSON field; `PriorAuthReportView` renders it with letterhead, citation table, and signature block, exported via `window.print()` + print CSS.
- **Files:** `app/api/chat/route.ts:123`, `components/PriorAuthReportView.tsx`.

### Q27. Is this production-safe for real hospitals today?
- **Short:** No — it's a well-architected prototype.
- **Deep:** Missing auth, RLS, audit, eval harness, and clinical sign-off make it demo/sandbox ready only. The safety rules make it clinically *conservative*, but compliance requires the hardening list in §15/§18.
- **Files:** overall.

---

## 22. FINAL TECHNICAL SUMMARY

- **Architecture in one sentence:** A Next.js 16 full-stack app where React chats with Next.js route handlers backed by a Supabase policy knowledge base and a Gemini reasoning layer.
- **AI pipeline in one sentence:** A schema-forced, low-temperature Gemini cascade turns a clinical note + retrieved policy text into a structured determination with citations and a justification letter.
- **RAG pipeline in one sentence:** Payer-tag → deterministic ILIKE retrieval of policy chunks → verbatim injection into the prompt → grounded, citable JSON output.
- **Image pipeline in one sentence:** Magic-byte-validated images run Gemini Vision OCR + image understanding, with Tesseract fallback, surfaced as labeled, non-evidentiary context.
- **Biggest technical strength:** Rigorous grounding discipline — policy evidence, OCR text, and image interpretation are kept strictly separated, making every verdict citable and auditable.
- **Biggest technical limitation:** Deterministic single-filter retrieval (no semantic search) combined with no in-repo auth/RLS limits both recall and production readiness.
- **Most important future improvement:** Add `pgvector` semantic/hybrid retrieval with top-K re-ranking, and ship Supabase Auth + RLS policies with a citation-fidelity evaluation harness.