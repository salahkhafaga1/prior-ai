import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { searchPayerPolicies, fetchAvailablePayers, PolicyDocument, logDiagnostic, logDiagnosticError } from '@/lib/supabase';
import { processClinicalImage, MAX_IMAGES_PER_REQUEST } from '@/lib/imageProcessing';
import { ImageAttachmentRequest, ProcessedImageAttachment } from '@/types/imageProcessing';
import { isArabicText, resolveResponseLanguage } from '@/lib/language';
import { Language } from '@/lib/i18n/translations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Active Google AI Studio model sequence
const GEMINI_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-1.5-flash',
  'gemini-2.0-flash',
];

const MAX_REQUEST_BODY_BYTES = 4.5 * 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isCleanText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 80) return false;
  const lower = trimmed.toLowerCase();
  if (
    trimmed.startsWith('%PDF') ||
    lower.includes('%pdf-') ||
    lower.includes('endstream') ||
    lower.includes('startxref') ||
    lower.includes('/filter')
  ) {
    return false;
  }
  return true;
}

const STRICT_SYSTEM_INSTRUCTION = `You are an expert Medical Director and Prior Authorization Verification Agent.
You are evaluating a patient's clinical chart note against an attached/retrieved Insurance Policy Document.

STRICT GROUNDING & VERIFICATION RULES:
1. Rely ONLY on the provided policy document text retrieved from the database. NEVER fabricate coverage rules or medical guidelines.
2. If the user input is vague or missing clinical details (e.g. 'Hi' or 'Check MRI'), do NOT generate a verification report. Instead, reply politely asking the physician to provide the patient's symptoms duration, conservative treatments tried, and mention the target payer using @PayerName. Set matchScore to 0, status to 'ACTION_REQUIRED', and checklist to an empty array.
3. When evaluating a full case, compare every clinical fact in the note against the policy rules.
4. For EVERY checklist criterion, you MUST state the EXACT Clause/Section and Verbatim Quote from the uploaded insurance policy.
5. REQUIRED JSON OUTPUT SCHEMA:
   {
     "matchScore": number (0 to 100),
     "status": "APPROVED" | "ACTION_REQUIRED" | "REJECTED",
     "summary": "Clear clinical summary explaining the verdict.",
     "checklist": [
       {
         "requirement": "Requirement description",
         "met": boolean,
         "sectionClause": "Exact policy section code/title",
         "exactPolicyQuote": "Verbatim string from the policy document",
         "patientEvidence": "Extracted evidence from patient note"
       }
     ],
     "missingRequirements": ["List of missing clinical items needed for approval"],
     "justificationLetter": "Formal physician-signed Prior Authorization letter citing exact policy sections, ready for export."
   }

ATTACHED IMAGES RULES:
6. OCR text extracted from an attached image is extracted document text and may be imperfect.
7. Image descriptions are AI-generated visual context ONLY. They are NOT authoritative medical evidence, measurements, verbatim records, or diagnoses.
8. Never use image descriptions for policy citations. Policy citations must come EXCLUSIVELY from the retrieved policy documents.

LANGUAGE & BILINGUAL RULES:
9. Respond in the SAME language as the user's latest message, or the explicitly requested language (RESPONSE_LANGUAGE in the prompt). Never auto-switch mid-answer.
10. If RESPONSE_LANGUAGE is 'ar': write all free-text fields (summary, requirement, patientEvidence, missingRequirements, justificationLetter) in Modern Standard Arabic, but KEEP the following in their ORIGINAL stored language (English): exactPolicyQuote, sectionClause, payer, policy title, CPT codes, policy numbers, procedure names, and medical abbreviations. Do not translate or paraphrase policy quotes.
11. If RESPONSE_LANGUAGE is 'en': write everything in English as before.
12. POLICY EVIDENCE RULE: Evidence must come ONLY from the retrieved policy content. Never fabricate coverage rules or medical guidelines.
13. CITATION RULE: Citations must reference the ORIGINAL policy source exactly as stored (payer name, policy title, clause/section, verbatim quote). Do NOT create translated or fabricated citations. Never cite the LLM, the image description, or clinical notes as policy evidence.
14. CLINICAL CONTEXT RULE: Patient-provided information may be Arabic, English, or mixed. Interpret all of it correctly without requiring the user to translate it. OCR output may be Arabic, English, or mixed; use it as-is.
15. IMAGE DESCRIPTION RULE: Image descriptions are descriptive context ONLY. Never treat them as authoritative medical measurements or policy evidence.
16. MEDICAL TERMINOLOGY RULE: For Arabic responses use standard Arabic medical terminology. For important terms, use "Arabic term (English term)", e.g. الاستئصال بالترددات الراديوية (Radiofrequency Ablation). Never alter the underlying policy meaning.
17. ARABIC REPORT RULE: When the user asks for a Prior Authorization report in Arabic, use headings such as: التقييم الطبي، معايير السياسة، المعلومات المدعومة، المعلومات الناقصة، المعلومات غير المستوفاة، الأدلة من السياسة، التوصية. Preserve CPT codes, policy numbers, procedure names, and citation references unchanged.`;

const RETRIEVAL_TRANSLATION_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
];

/**
 * Lightweight Arabic -> English query translator used ONLY as a retrieval
 * fallback (payer detection). The original Arabic query remains the reasoning
 * prompt and is never stored or translated permanently.
 */
async function translateQueryForRetrieval(
  userPrompt: string,
  availablePayers: string[]
): Promise<{ payer: string; englishQuery: string }> {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!apiKey) return { payer: '', englishQuery: userPrompt };

  const ai = new GoogleGenAI({ apiKey });
  const instruction = `You are a medical prior-authorization retrieval assistant. The user wrote a clinical query, possibly in Arabic.
Identify the target insurance payer from the provided list (if mentioned), and translate the clinical query to English for RETRIEVAL ONLY.
Available payers: ${availablePayers.join(', ')}
Return JSON with exactly two fields:
{"payer": "exact payer id from the list that matches, or empty string if none is mentioned", "englishQuery": "faithful English translation of the clinical query, keeping medical terminology standard"}
Do not translate or modify any policy document text. If the query is already English, return it unchanged.`;

  let lastError: unknown = null;
  for (const modelName of RETRIEVAL_TRANSLATION_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: userPrompt,
        config: {
          systemInstruction: instruction,
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });
      const parsed = JSON.parse(response?.text || '{}');
      return {
        payer: String(parsed.payer || '').trim(),
        englishQuery: String(parsed.englishQuery || userPrompt),
      };
    } catch (err: any) {
      lastError = err;
      logDiagnosticError('[GEMINI API LOG]', `Retrieval translation model ${modelName} failed`, err);
      await sleep(800);
    }
  }
  logDiagnosticError('[GEMINI API LOG]', 'All retrieval translation models failed', lastError);
  return { payer: '', englishQuery: userPrompt };
}

const STRICT_JSON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    status: {
      type: Type.STRING,
      enum: ['APPROVED', 'ACTION_REQUIRED', 'REJECTED'],
      description: 'Prior authorization determination status',
    },
    matchScore: {
      type: Type.NUMBER,
      description: 'Percentage of policy criteria met (0 to 100)',
    },
    summary: {
      type: Type.STRING,
      description: 'Clear clinical summary explaining the verdict',
    },
    checklist: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          requirement: {
            type: Type.STRING,
            description: 'Requirement description',
          },
          met: {
            type: Type.BOOLEAN,
            description: 'Whether requirement is met in the clinical notes',
          },
          sectionClause: {
            type: Type.STRING,
            description: 'Exact policy section code/title',
          },
          exactPolicyQuote: {
            type: Type.STRING,
            description: 'Verbatim string from the policy document',
          },
          patientEvidence: {
            type: Type.STRING,
            description: 'Extracted evidence from patient note or gap description',
          },
        },
        required: [
          'requirement',
          'met',
          'sectionClause',
          'exactPolicyQuote',
          'patientEvidence',
        ],
      },
      description: 'Checklist of verified policy criteria',
    },
    missingRequirements: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'List of missing clinical items needed for approval',
    },
    justificationLetter: {
      type: Type.STRING,
      description:
        'Formal physician-signed Prior Authorization letter citing exact policy sections, ready for export.',
    },
  },
  required: [
    'status',
    'matchScore',
    'summary',
    'checklist',
    'missingRequirements',
    'justificationLetter',
  ],
};

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    logDiagnostic('[RAG ENGINE LOG]', 'Received clinical evaluation request...');

    const rawLength = Number(req.headers.get('content-length') || 0);
    if (rawLength > MAX_REQUEST_BODY_BYTES) {
      logDiagnosticError('[RAG ENGINE LOG]', `Request body too large: ${rawLength} bytes.`);
      return NextResponse.json(
        {
          success: false,
          source: '[RAG Pipeline]',
          errorCode: 'PAYLOAD_TOO_LARGE',
          message: 'Request payload exceeds the 4.5 MB hosting platform limit.',
          details: `Received ${(rawLength / 1048576).toFixed(1)} MB. Attach fewer or smaller images and try again.`,
        },
        { status: 413 }
      );
    }

    const body = await req.json();
    const { message, messages, payer, fileData, images, language } = body;

    const userPrompt =
      message || (messages && messages[messages.length - 1]?.content) || '';

    const effectiveLanguage: Language = resolveResponseLanguage(language, userPrompt);
    logDiagnostic('[RAG ENGINE LOG]', `Response language resolved: "${effectiveLanguage}" (explicit: ${language || 'none'}).`);

    const rawImages: ImageAttachmentRequest[] = Array.isArray(images) ? images : [];

    // 1. Diagnostics: Check Input Payload
    if (!userPrompt.trim() && !fileData && rawImages.length === 0) {
      logDiagnosticError('[RAG ENGINE LOG]', 'Validation failed: empty clinical prompt.');
      return NextResponse.json(
        {
          success: false,
          source: '[RAG Pipeline]',
          errorCode: 'EMPTY_PROMPT',
          message: 'Clinical prompt or EHR chart note is required.',
          details: 'Please enter patient clinical notes or attach a chart record file before submitting.',
        },
        { status: 400 }
      );
    }

    // 2. Diagnostics: Verify Gemini API Key Configuration
    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    if (!apiKey || apiKey === 'your_actual_gemini_api_key_here' || apiKey.trim() === '') {
      logDiagnosticError('[GEMINI API LOG]', 'GEMINI_API_KEY is missing in environment.');
      return NextResponse.json(
        {
          success: false,
          source: '[Gemini API]',
          errorCode: 'MISSING_API_KEY',
          message: 'Gemini API Key is not configured.',
          details: 'Please ensure GEMINI_API_KEY is properly set in your .env.local file.',
        },
        { status: 500 }
      );
    }

    // 3. Diagnostics: Query Available Payers from Supabase
    logDiagnostic('[RAG ENGINE LOG]', 'Fetching available payers dynamically from Supabase...');
    const payerStart = Date.now();
    const payersResult = await fetchAvailablePayers();
    logDiagnostic('[SUPABASE LOG]', `Payers query completed in ${Date.now() - payerStart}ms.`);

    if (payersResult.error) {
      logDiagnosticError('[SUPABASE LOG]', 'Failed to query payers from database', payersResult.error);
      return NextResponse.json(
        {
          success: false,
          source: payersResult.error.source,
          errorCode: payersResult.error.errorCode,
          message: payersResult.error.message,
          details: payersResult.error.details,
        },
        { status: 500 }
      );
    }

    const availablePayers = payersResult.data || [];

    if (availablePayers.length === 0) {
      logDiagnosticError('[RAG ENGINE LOG]', 'No valid policy documents found in Supabase.');
      return NextResponse.json(
        {
          success: false,
          source: '[Supabase DB]',
          errorCode: 'NO_PAYERS_IN_DATABASE',
          message: 'No insurance policy documents found in database.',
          details:
            'The policy_documents table has no readable entries. Please open the "Insurance Policy Library" and upload a policy PDF.',
        },
        { status: 400 }
      );
    }

    // 4. Detect Target Payer Tag (with Arabic cross-language retrieval fallback)
    let detectedPayer = payer || '';
    const tagMatch = userPrompt.match(/@([a-zA-Z0-9_\-]+)/);

    if (tagMatch && tagMatch[1]) {
      detectedPayer = tagMatch[1];
    } else if (!detectedPayer && availablePayers.length > 0) {
      const foundInText = availablePayers.find((p) =>
        userPrompt.toLowerCase().includes(p.toLowerCase())
      );
      if (foundInText) {
        detectedPayer = foundInText;
      } else if (isArabicText(userPrompt)) {
        // Arabic query: no @tag and no Latin payer string matched.
        // Translate ONLY for retrieval (payer identification); keep the original Arabic prompt.
        logDiagnostic(
          '[RAG ENGINE LOG]',
          'Arabic query detected with no explicit payer tag. Running lightweight retrieval translation fallback...'
        );
        const translated = await translateQueryForRetrieval(userPrompt, availablePayers);
        const foundInTranslation =
          availablePayers.find((p) =>
            translated.englishQuery.toLowerCase().includes(p.toLowerCase())
          ) || translated.payer;
        if (foundInTranslation) {
          detectedPayer = foundInTranslation;
          logDiagnostic(
            '[RAG ENGINE LOG]',
            `Cross-language retrieval fallback identified payer "${detectedPayer}" from translated Arabic query.`
          );
        } else {
          logDiagnostic(
            '[RAG ENGINE LOG]',
            'Arabic retrieval translation found no explicit payer; falling back to first available payer.'
          );
          detectedPayer = availablePayers[0];
        }
      } else {
        detectedPayer = availablePayers[0];
      }
    } else if (!detectedPayer && availablePayers.length > 0) {
      detectedPayer = availablePayers[0];
    }

    logDiagnostic('[RAG ENGINE LOG]', `Target payer detected: "${detectedPayer}"`);

    // 5. Query Supabase for Grounding Policy Documents
    logDiagnostic('[SUPABASE LOG]', `Retrieving policy documents for "${detectedPayer}"...`);
    const policyStart = Date.now();
    const policyResult = await searchPayerPolicies(detectedPayer);
    logDiagnostic('[SUPABASE LOG]', `Policy search completed in ${Date.now() - policyStart}ms.`);

    if (policyResult.error) {
      logDiagnosticError('[SUPABASE LOG]', `Policy search failed for "${detectedPayer}"`, policyResult.error);
      return NextResponse.json(
        {
          success: false,
          source: policyResult.error.source,
          errorCode: policyResult.error.errorCode,
          message: policyResult.error.message,
          details: policyResult.error.details,
        },
        { status: 500 }
      );
    }

    const rawDocs: PolicyDocument[] = policyResult.data || [];

    if (rawDocs.length === 0) {
      logDiagnosticError('[RAG ENGINE LOG]', `No policy documents found in Supabase for payer "@${detectedPayer}"`);
      return NextResponse.json(
        {
          success: false,
          source: '[RAG Pipeline]',
          errorCode: 'NO_PAYER_MATCH',
          message: `No policy document found for payer "@${detectedPayer}" in the database.`,
          details: `Available payers currently in Supabase: [${availablePayers.join(
            ', '
          )}]. Please upload the official policy PDF for ${detectedPayer} via the Policy Library.`,
          availablePayers,
        },
        { status: 404 }
      );
    }

    // 6. VALIDATE RETRIEVED POLICY CONTENT (DETECT UNPARSED RAW STREAMS)
    const validDocs = rawDocs.filter((doc) => isCleanText(doc.content));

    const totalContentLength = validDocs.reduce(
      (acc, doc) => acc + (doc.content?.trim().length || 0),
      0
    );

    if (validDocs.length === 0) {
      logDiagnosticError(
        '[RAG ENGINE LOG]',
        `Policy document for @${detectedPayer} contains unparsed raw stream data (%PDF / binary code).`
      );
      return NextResponse.json(
        {
          success: false,
          source: '[RAG Pipeline]',
          errorCode: 'UNPARSED_PDF_STREAM',
          message: `The policy document stored for @${detectedPayer} is unparsed binary stream data. Please re-upload a readable PDF.`,
          details: `The database record contains raw %PDF binary streams. Please delete the existing entry in the Policy Library and re-upload the PDF so Gemini Vision OCR can extract clean text.`,
        },
        { status: 422 }
      );
    }

    if (totalContentLength < 100) {
      logDiagnosticError(
        '[RAG ENGINE LOG]',
        `Policy document for @${detectedPayer} contains insufficient text (${totalContentLength} chars).`
      );
      return NextResponse.json(
        {
          success: false,
          source: '[RAG Pipeline]',
          errorCode: 'EMPTY_POLICY_CONTENT',
          message: `[RAG Error] The uploaded policy document for @${detectedPayer} contains no readable text. Please re-upload the PDF using the Policy Library.`,
          details: `Total characters retrieved: ${totalContentLength}. Please delete this entry and re-upload the PDF.`,
        },
        { status: 422 }
      );
    }

    logDiagnostic(
      '[RAG ENGINE LOG]',
      `Retrieved ${validDocs.length} clean policy chunks (${totalContentLength} total characters) for "@${detectedPayer}".`
    );

    // 7. Process Attached Clinical Images (OCR + Image Understanding)
    const imagesToProcess = rawImages.slice(0, MAX_IMAGES_PER_REQUEST);
    if (rawImages.length > MAX_IMAGES_PER_REQUEST) {
      logDiagnostic(
        '[RAG ENGINE LOG]',
        `Request contained ${rawImages.length} images; processing first ${MAX_IMAGES_PER_REQUEST} only.`
      );
    }

    const attachments: ProcessedImageAttachment[] = [];
    const imgStart = Date.now();
    if (imagesToProcess.length > 0) {
      const processed = await Promise.all(
        imagesToProcess.map((img) =>
          processClinicalImage(img, { skipLocalFallback: true, language: effectiveLanguage })
        )
      );
      attachments.push(...processed);
      logDiagnostic(
        '[RAG ENGINE LOG]',
        `Processed ${processed.length} image(s) in ${Date.now() - imgStart}ms (parallel, no local OCR fallback).`
      );
    }

    const attachmentBlocks = attachments.filter((a) => a.ocrText || a.imageDescription);
    let attachmentContext = '';
    if (attachmentBlocks.length > 0) {
      attachmentContext =
        '\n\nPATIENT/CLINICAL CONTEXT FROM ATTACHED IMAGES:\n' +
        attachmentBlocks
          .map((a, i) => {
            const lines = [`[IMAGE ${i + 1}: ${a.fileName} (${a.mimeType})]`];
            if (a.ocrText) {
              lines.push(`[OCR TEXT]\n"""\n${a.ocrText}\n"""`);
            }
            if (a.imageDescription) {
              lines.push(`[IMAGE DESCRIPTION]\n"""\n${a.imageDescription}\n"""`);
            }
            return lines.join('\n');
          })
          .join('\n\n');
      logDiagnostic(
        '[RAG ENGINE LOG]',
        `Built clinical context from ${attachmentBlocks.length} image attachment(s).`
      );
    }

    // 8. Build Grounded Context String
    const policyContext = validDocs
      .map(
        (doc, i) =>
          `[POLICY DOCUMENT ${i + 1}]
Payer: ${doc.payer}
Document Title: ${doc.title}
Procedure Type: ${doc.procedure_type || 'General Policy'}
Clause / Section: ${doc.clause_section || 'Clinical Policy Criteria'}
Policy Requirement Text:
"""
${doc.content}
"""`
      )
      .join('\n\n====================\n\n');

    // 9. Non-Blocking Dynamic Cascade Engine
    const ai = new GoogleGenAI({ apiKey });

    const fullPrompt = `PHYSICIAN'S CLINICAL CHART NOTE / PROMPT:
"""
${userPrompt}
"""
${attachmentContext}
TARGET INSURANCE PAYER: ${detectedPayer}
RESPONSE_LANGUAGE: ${effectiveLanguage}

RETRIEVED INSURANCE POLICY GROUND TRUTH (SUPABASE DATABASE):
${policyContext}

Evaluate this clinical encounter against the retrieved insurance policy criteria.
Respond in RESPONSE_LANGUAGE. Policy evidence and citations MUST come only from the retrieved policy text, in its original language.`;

    let responseText: string | null = null;
    let successfulModel = '';
    let lastError: any = null;

    for (const modelName of GEMINI_MODELS) {
      try {
        console.log(`[RAG Engine] Attempting model: ${modelName}`);
        logDiagnostic('[GEMINI API LOG]', `Attempting generation with model: "${modelName}"...`);

        const response = await ai.models.generateContent({
          model: modelName,
          contents: fullPrompt,
          config: {
            systemInstruction: STRICT_SYSTEM_INSTRUCTION,
            temperature: 0.1, // Strict zero-hallucination medical review
            responseMimeType: 'application/json',
            responseSchema: STRICT_JSON_SCHEMA,
          },
        });

        responseText = response?.text || null;

        if (responseText) {
          console.log(`[RAG Engine] Successfully executed with model: ${modelName}`);
          logDiagnostic('[GEMINI API LOG]', `Successfully generated response using model "${modelName}".`);
          successfulModel = modelName;
          break;
        }
      } catch (err: any) {
        console.warn(`[RAG Engine] Model ${modelName} failed with error: ${err?.message || err}`);
        logDiagnosticError('[GEMINI API LOG]', `Model ${modelName} failed: ${err?.message || err}`);
        lastError = err;

        // Delay for 1 second to handle rate-limiting before falling back
        await sleep(1000);
      }
    }

    if (!responseText) {
      logDiagnosticError('[GEMINI API LOG]', 'All model candidates in fallback cascade failed', lastError);
      return NextResponse.json(
        {
          success: false,
          source: '[Gemini API]',
          errorCode: 'GEMINI_CASCADE_FAILED',
          message: `[Gemini API] Cascade failed. Last error: ${lastError?.message || 'All models failed.'}`,
          error: `[Gemini API] Cascade failed. Last error: ${lastError?.message || 'All models failed.'}`,
          details: lastError?.message || String(lastError),
        },
        { status: 500 }
      );
    }

    // 9. Diagnostics: Validate JSON Parsing
    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
      logDiagnostic(
        '[RAG ENGINE LOG]',
        `Evaluation completed in ${Date.now() - startTime}ms via ${successfulModel}. Status: ${parsedData.status} (Score: ${parsedData.matchScore}%)`
      );
    } catch (parseErr: any) {
      logDiagnosticError('[RAG ENGINE LOG]', 'JSON parse error on Gemini response', parseErr);
      return NextResponse.json(
        {
          success: false,
          source: '[RAG Pipeline]',
          errorCode: 'PARSE_ERROR',
          message: 'Failed to parse Gemini model JSON output.',
          details: `Raw text: ${responseText.slice(0, 300)}... | Error: ${parseErr?.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      payer: detectedPayer,
      policyTitle: validDocs[0]?.title || `${detectedPayer} Policy`,
      modelUsed: successfulModel,
      responseLanguage: effectiveLanguage,
      attachments,
      ...parsedData,
    });
  } catch (error: any) {
    logDiagnosticError('[RAG ENGINE LOG]', 'Unhandled server exception in /api/chat', error);
    return NextResponse.json(
      {
        success: false,
        source: '[RAG Pipeline]',
        errorCode: 'UNHANDLED_EXCEPTION',
        message: 'Internal server error while evaluating clinical note against policy.',
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
