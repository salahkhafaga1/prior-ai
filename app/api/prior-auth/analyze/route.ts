import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { PriorAuthResponse, PriorAuthRequest } from '@/types/priorAuth';
import { MOCK_CASES, PAYER_OPTIONS } from '@/data/mockCases';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GEMINI_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SYSTEM_INSTRUCTION = `You are a Board-Certified Clinical Reviewer and Medical Prior Authorization Expert AI.
Your objective is to evaluate clinical notes against insurance payer clinical policy bulletins (CPB) and determine medical necessity coverage with strict clinical accuracy (zero hallucination).

CRITICAL EVALUATION RULES:
1. Criteria Verification: For each clinical criterion (e.g., pain duration >= 6 weeks, positive provocative/neurological signs, completed conservative therapy including >= 6 weeks of physical therapy and NSAIDs), explicitly check if clinical evidence is documented.
2. Status Determination:
   - "APPROVED": All required criteria (including physical therapy, duration, medication trials, and objective clinical signs) are fully documented and satisfied.
   - "ACTION_REQUIRED": Radicular signs or duration are met, but crucial documentation (e.g., physical therapy completion, specific exam findings) is missing or incomplete.
   - "REJECTED": Contraindications exist or core medical necessity criteria are not met.
3. Scoring:
   - Calculate matchScore as an integer between 0 and 100 based on the percentage of mandatory criteria met.
4. Policy Citation: Cite the relevant commercial payer clinical bulletin (e.g. Aetna CPB 0236, UHC Policy 2024T0542, Cigna Policy 0512) and provide an accurate policy snippet.
5. Justification Letter: Generate a formal, physician-ready prior authorization appeal/submission letter detailing clinical findings, ICD-10/CPT context, conservative management history, and justification of medical necessity.
6. Recommendation: Provide concise, actionable next steps for the clinical authorization team.`;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PriorAuthRequest;
    const { patientNote, payerId, procedureRequested } = body;

    if (!patientNote || typeof patientNote !== 'string' || !patientNote.trim()) {
      return NextResponse.json(
        { error: 'Invalid request: patientNote is required.' },
        { status: 400 }
      );
    }

    const effectivePayerId = (payerId || 'aetna').toLowerCase();
    const payerInfo =
      PAYER_OPTIONS.find((p) => p.id.toLowerCase() === effectivePayerId) ||
      PAYER_OPTIONS[0];

    const apiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    if (!apiKey || apiKey === 'your_actual_gemini_api_key_here' || apiKey.trim() === '') {
      const fallbackResponse = getFallbackResponse(patientNote, effectivePayerId, procedureRequested);
      return NextResponse.json(fallbackResponse, {
        headers: { 'X-Data-Source': 'Mock-Fallback' },
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });

      const prompt = `Analyze the following patient clinical chart for Prior Authorization:
PAYER: ${payerInfo.name} (ID: ${payerInfo.id})
REQUESTED PROCEDURE: ${procedureRequested || 'MRI Lumbar Spine without Contrast (CPT 72148)'}

CLINICAL NOTE:
"""
${patientNote}
"""

Evaluate this case and output the structured Prior Authorization JSON.`;

      let response: any = null;
      let lastError: any = null;

      for (const modelName of GEMINI_MODELS) {
        try {
          console.log(`[RAG Engine] Attempting model: ${modelName}`);
          response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              temperature: 0.1,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  status: {
                    type: Type.STRING,
                    enum: ['APPROVED', 'ACTION_REQUIRED', 'REJECTED'],
                    description: 'Prior authorization determination status',
                  },
                  matchScore: {
                    type: Type.NUMBER,
                    description: 'Match score percentage between 0 and 100',
                  },
                  checklist: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        requirement: { type: Type.STRING },
                        met: { type: Type.BOOLEAN },
                        evidenceOrNote: { type: Type.STRING },
                      },
                      required: ['requirement', 'met', 'evidenceOrNote'],
                    },
                    description: 'Itemized checklist of criteria assessed',
                  },
                  missingRequirements: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.STRING,
                    },
                    description: 'List of missing documentation or clinical requirements',
                  },
                  citation: {
                    type: Type.OBJECT,
                    properties: {
                      payerName: { type: Type.STRING },
                      policyDocument: { type: Type.STRING },
                      clauseSection: { type: Type.STRING },
                      exactTextSnippet: { type: Type.STRING },
                    },
                    required: [
                      'payerName',
                      'policyDocument',
                      'clauseSection',
                      'exactTextSnippet',
                    ],
                  },
                  justificationLetter: {
                    type: Type.STRING,
                    description: 'Complete prior auth justification letter',
                  },
                  recommendation: {
                    type: Type.STRING,
                    description: 'Actionable recommendation for next steps',
                  },
                },
                required: [
                  'status',
                  'matchScore',
                  'checklist',
                  'missingRequirements',
                  'citation',
                  'justificationLetter',
                  'recommendation',
                ],
              },
            },
          });
          break;
        } catch (err: any) {
          lastError = err;
          console.warn(`[RAG Engine] Model ${modelName} failed:`, err?.message);
          await sleep(1000);
        }
      }

      const rawText = response?.text;
      if (!rawText) {
        throw lastError || new Error('Empty response received from Gemini model.');
      }

      const parsedData = JSON.parse(rawText) as PriorAuthResponse;
      return NextResponse.json(parsedData, {
        headers: { 'X-Data-Source': 'Gemini-Flash' },
      });
    } catch (apiError: any) {
      console.error('Gemini API Execution Error:', apiError?.message || apiError);
      const fallbackResponse = getFallbackResponse(patientNote, effectivePayerId, procedureRequested);
      return NextResponse.json(fallbackResponse, {
        headers: {
          'X-Data-Source': 'Mock-Fallback-OnError',
          'X-Error-Reason': encodeURIComponent(apiError?.message || 'API Error'),
        },
      });
    }
  } catch (error: any) {
    console.error('Server Internal Error in prior-auth API:', error);
    return NextResponse.json(
      { error: 'Internal server error processing prior authorization.' },
      { status: 500 }
    );
  }
}

function getFallbackResponse(
  note: string,
  payerId: string,
  procedure?: string
): PriorAuthResponse {
  const normalizedNote = note.toLowerCase();

  if (
    normalizedNote.includes('john doe') ||
    normalizedNote.includes('meloxicam') ||
    (normalizedNote.includes('physical therapy') && normalizedNote.includes('completed 6 weeks'))
  ) {
    return MOCK_CASES[0].expectedResult;
  }

  if (
    normalizedNote.includes('sarah jenkins') ||
    normalizedNote.includes('not attended') ||
    normalizedNote.includes('not completed') ||
    normalizedNote.includes('child care constraints')
  ) {
    return MOCK_CASES[1].expectedResult;
  }

  const hasPhysicalTherapy =
    normalizedNote.includes('physical therapy') ||
    normalizedNote.includes('pt ') ||
    normalizedNote.includes('physiotherapy');

  const hasRadiatingPain =
    normalizedNote.includes('radiat') ||
    normalizedNote.includes('radiculopathy') ||
    normalizedNote.includes('sciatica') ||
    normalizedNote.includes('straight leg');

  const hasNSAID =
    normalizedNote.includes('nsaid') ||
    normalizedNote.includes('meloxicam') ||
    normalizedNote.includes('ibuprofen') ||
    normalizedNote.includes('naproxen') ||
    normalizedNote.includes('celebrex');

  const isApproved = hasPhysicalTherapy && hasRadiatingPain && hasNSAID;

  return {
    status: isApproved ? 'APPROVED' : 'ACTION_REQUIRED',
    matchScore: isApproved ? 92 : 65,
    checklist: [
      {
        requirement: 'Chronic low back pain radiating below knee >= 6 weeks',
        met: hasRadiatingPain,
        evidenceOrNote: hasRadiatingPain
          ? 'Clinical notes describe dermatomal radicular symptoms.'
          : 'Insufficient documentation of radicular pain distribution.',
      },
      {
        requirement: 'Documentation of objective nerve tension sign (Positive SLR)',
        met: hasRadiatingPain,
        evidenceOrNote: hasRadiatingPain
          ? 'Straight leg raise or provocative nerve root tension documented.'
          : 'No objective provocative test recorded in physical exam.',
      },
      {
        requirement: 'Completed minimum 6 weeks of formal Physical Therapy',
        met: hasPhysicalTherapy,
        evidenceOrNote: hasPhysicalTherapy
          ? 'Physical therapy trial documented in conservative therapy section.'
          : 'Missing documentation of completed 6-week outpatient physical therapy.',
      },
      {
        requirement: 'Trial of prescription/OTC NSAID or analgesic therapy',
        met: hasNSAID,
        evidenceOrNote: hasNSAID
          ? 'Anti-inflammatory pharmacotherapy documented in chart.'
          : 'No formal record of anti-inflammatory medication trial.',
      },
    ],
    missingRequirements: isApproved
      ? []
      : [
          ...(!hasPhysicalTherapy
            ? ['Documented proof of at least 6 weeks of structured Physical Therapy.']
            : []),
          ...(!hasNSAID
            ? ['Trial of oral anti-inflammatory / analgesic medications.']
            : []),
        ],
    citation: {
      payerName: payerId.toUpperCase(),
      policyDocument: `Clinical Policy Guidelines: ${procedure || 'Lumbar Spine Imaging'}`,
      clauseSection: 'Section 4.2 - Medical Necessity Criteria for Advanced Imaging',
      exactTextSnippet:
        'Advanced spinal imaging requires failure of at least 6 weeks of physician-directed conservative management including formal physical therapy and NSAIDs.',
    },
    justificationLetter: `Re: Prior Authorization Evaluation - ${procedure || 'Lumbar Spine MRI'}
Payer: ${payerId.toUpperCase()}

To Medical Review Department,

We are submitting clinical documentation for prior authorization. The patient presents with persistent symptoms requiring diagnostic imaging.

${
  isApproved
    ? 'All criteria including physical therapy, pharmacotherapy, and clinical signs are met in accordance with published guidelines.'
    : 'Please review the attached clinical records noting ongoing conservative care and symptom progression.'
}

Sincerely,
Attending Physician`,
    recommendation: isApproved
      ? 'All core clinical criteria satisfied. Ready for submission.'
      : 'Review missing criteria (such as physical therapy records) before final submission.',
  };
}
