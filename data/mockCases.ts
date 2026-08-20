import { MockCase } from '@/types/priorAuth';

export const MOCK_CASES: MockCase[] = [
  {
    id: 'case-aetna-lumbar-mri-001',
    title: 'Case 1: Lumbar MRI (Meets All Criteria)',
    patientName: 'John Doe',
    patientAge: 48,
    patientGender: 'Male',
    payerId: 'aetna',
    payerName: 'Aetna Health Inc.',
    procedureRequested: 'MRI Lumbar Spine without Contrast (CPT 72148)',
    clinicalNote: `CHIEF COMPLAINT:
Severe lower back pain radiating down the left leg (L5-S1 distribution) for 8 weeks.

HISTORY OF PRESENT ILLNESS:
The patient is a 48-year-old male presenting with chronic, progressive low back pain radiating into the left buttock, posterolateral thigh, and lateral foot for 8 weeks. Pain is rated 7/10 and aggravated by prolonged sitting, coughing, and bending forward.

PRIOR CONSERVATIVE THERAPY:
1. Physical Therapy: Completed 6 weeks of formal, supervised outpatient physical therapy (2 sessions/week for 12 total visits, focused on core stabilization, lumbar traction, and McKenzie extensions) ending 10 days ago, with minimal relief.
2. Pharmacotherapy: 6-week continuous regimen of Meloxicam 15mg daily and Cyclobenzaprine 10mg PRN.
3. Activity modification: Ergonomic workplace adjustments and home exercise program attempted for 8 weeks.

PHYSICAL EXAMINATION:
- Lumbar range of motion: Restricted forward flexion by 40% due to sharp lower back pain.
- Neurological exam: Sensation diminished along the left L5/S1 dermatome (lateral foot and great toe). Motor strength 4/5 in left ankle dorsiflexion and EHL.
- Provocative testing: Positive Straight Leg Raise (SLR) on the left side at 45 degrees reproducing radiating leg pain. Negative on right.
- Red Flags: Negative for bowel/bladder dysfunction, saddle anesthesia, fever, chills, unexplained weight loss, or history of malignancy.

ASSESSMENT & PLAN:
Left L5-S1 lumbar radiculopathy secondary to suspected herniated nucleus pulposus. Failed conservative therapy (>6 weeks PT + NSAIDs). Requesting Prior Authorization for MRI Lumbar Spine without Contrast (CPT 72148) for definitive surgical/interventional evaluation.`,
    expectedResult: {
      status: 'APPROVED',
      matchScore: 96,
      checklist: [
        {
          requirement: 'Duration of radicular low back pain >= 6 weeks',
          met: true,
          evidenceOrNote: 'Patient reports 8 weeks of progressive lumbar pain radiating down the left L5-S1 distribution.'
        },
        {
          requirement: 'Documented objective neurological finding or positive nerve root tension sign',
          met: true,
          evidenceOrNote: 'Positive Left Straight Leg Raise (SLR) at 45°, diminished L5/S1 sensation, 4/5 left EHL strength.'
        },
        {
          requirement: 'Completed >= 6 weeks of supervised Physical Therapy',
          met: true,
          evidenceOrNote: 'Completed 12 visits over 6 weeks of formal outpatient PT (core stabilization, lumbar traction) with minimal relief.'
        },
        {
          requirement: 'Trial of anti-inflammatory / analgesic pharmacotherapy',
          met: true,
          evidenceOrNote: 'Completed 6-week continuous regimen of Meloxicam 15mg PO daily and Cyclobenzaprine 10mg.'
        },
        {
          requirement: 'Absence of untreated red flag contraindications',
          met: true,
          evidenceOrNote: 'Screened negative for cauda equina syndrome, fever, malignancy, or acute fractures.'
        }
      ],
      missingRequirements: [],
      citation: {
        payerName: 'Aetna Health',
        policyDocument: 'Clinical Policy Bulletin (CPB) 0236: Magnetic Resonance Imaging (MRI) of the Spine',
        clauseSection: 'Section II.B - Lumbar Spine MRI Indications (Radiculopathy)',
        exactTextSnippet: 'Aetna considers lumbar spine MRI medically necessary for members with radiculopathy radiating below the knee when there is a documented positive nerve root tension sign (e.g., straight leg raise) and failure of at least 6 weeks of physician-directed conservative management including formal physical therapy and NSAIDs.'
      },
      justificationLetter: `Re: Prior Authorization Request for Lumbar Spine MRI (CPT 72148)
Patient: John Doe (DOB: 05/14/1976) | Payer: Aetna Health | Provider ID: NPI-9842103411

To Prior Authorization Medical Review Committee,

I am writing to request urgent prior authorization for an uncontrasted Lumbar Spine MRI (CPT 72148) for our patient, John Doe. The patient is a 48-year-old male who has been suffering from debilitating lumbar radiculopathy radiating down the left lower extremity (L5-S1) for 8 consecutive weeks.

Clinical Examination and Objective Findings:
- Positive Straight Leg Raise (SLR) on the left side at 45 degrees reproducing dermatomal radicular symptoms.
- Motor weakness (4/5 left ankle dorsiflexion/EHL) and sensory deficit across the left L5/S1 dermatome.

Failure of Conservative Management:
The patient has diligently completed an exhaustive 6-week course of conservative care, consisting of:
1. 6 weeks of structured, supervised outpatient physical therapy (12 sessions), focusing on lumbar decompression and strengthening.
2. 6 weeks of continuous NSAID pharmacotherapy (Meloxicam 15mg daily) along with muscle relaxants.

These clinical findings and conservative treatment timelines fully satisfy the medical necessity criteria outlined in Aetna Clinical Policy Bulletin 0236 (Section II.B). Given persistent radicular deficits, magnetic resonance imaging is urgently required to guide surgical and interventional management.

Thank you for your prompt review and approval.`,
      recommendation: 'All clinical criteria, conservative therapy prerequisites, and policy requirements are satisfied. The request is ready for submission.'
    }
  },
  {
    id: 'case-uhc-lumbar-mri-002',
    title: 'Case 2: Lumbar MRI (Missing Physical Therapy)',
    patientName: 'Sarah Jenkins',
    patientAge: 42,
    patientGender: 'Female',
    payerId: 'uhc',
    payerName: 'UnitedHealthcare',
    procedureRequested: 'MRI Lumbar Spine without Contrast (CPT 72148)',
    clinicalNote: `CHIEF COMPLAINT:
Lower back pain radiating into right gluteal region and posterior thigh for 8 weeks.

HISTORY OF PRESENT ILLNESS:
The patient is a 42-year-old female presenting with 8 weeks of dull, aching low back pain radiating into her right posterior thigh. Pain fluctuates between 5/10 and 8/10.

CONSERVATIVE MANAGEMENT / TREATMENTS TRIED:
1. Pharmacotherapy: Patient has been taking over-the-counter and prescribed Ibuprofen 800mg TID and Acetaminophen for 8 weeks with temporary relief.
2. Physical Therapy: Patient was referred for physical therapy 6 weeks ago, but states she has NOT attended or completed any formal physical therapy sessions due to child care constraints and scheduling conflicts. No active home rehabilitation program documented.
3. Injections / Interventions: None.

PHYSICAL EXAMINATION:
- Spine: Moderate lumbar paraspinal muscle tenderness on the right.
- Neurological: Sensation intact bilaterally to light touch. Motor strength 5/5 in all lower extremity muscle groups.
- Provocative signs: Mildly positive right Straight Leg Raise at 50 degrees; negative left SLR.
- Red Flags: No bowel or bladder incontinence, no constitutional symptoms.

ASSESSMENT & PLAN:
Subacute right lumbar back pain with radicular symptoms. Prescribed muscle relaxant. Requesting Prior Authorization for MRI Lumbar Spine without Contrast (CPT 72148).`,
    expectedResult: {
      status: 'ACTION_REQUIRED',
      matchScore: 68,
      checklist: [
        {
          requirement: 'Duration of radicular low back pain >= 6 weeks',
          met: true,
          evidenceOrNote: 'Patient reports 8 weeks of continuous pain radiating to the right posterior thigh.'
        },
        {
          requirement: 'Documented objective neurological finding or positive nerve root tension sign',
          met: true,
          evidenceOrNote: 'Mildly positive right Straight Leg Raise at 50 degrees; motor strength intact (5/5).'
        },
        {
          requirement: 'Completed >= 6 weeks of supervised Physical Therapy',
          met: false,
          evidenceOrNote: 'Patient was referred but has NOT attended or completed any supervised physical therapy sessions.'
        },
        {
          requirement: 'Trial of anti-inflammatory / analgesic pharmacotherapy',
          met: true,
          evidenceOrNote: 'Completed 8-week trial of prescription Ibuprofen 800mg TID.'
        },
        {
          requirement: 'Absence of untreated red flag emergencies requiring immediate imaging waiver',
          met: true,
          evidenceOrNote: 'No cauda equina syndrome, no progressive motor deficits, no history of malignancy.'
        }
      ],
      missingRequirements: [
        'Documentation of at least 6 weeks of completed, supervised outpatient Physical Therapy or active clinician-directed rehabilitation.',
        'If physical therapy is clinically contraindicated, a detailed medical exception letter from the attending physician must be provided.'
      ],
      citation: {
        payerName: 'UnitedHealthcare',
        policyDocument: 'Medical Benefit Policy 2024T0542: Spine Imaging (CT and MRI Protocols)',
        clauseSection: 'Criteria 3.1.A - Lumbar Spine Imaging Conservative Therapy Prerequisite',
        exactTextSnippet: 'Prior authorization for lumbar spine MRI requires documentation of at least 6 weeks of structured physical therapy or physician-supervised active rehabilitation within the preceding 6 months, unless rapid progressive motor deficit or cauda equina symptoms are documented.'
      },
      justificationLetter: `Re: Prior Authorization Documentation Notice - Lumbar Spine MRI (CPT 72148)
Patient: Sarah Jenkins (DOB: 11/20/1981) | Payer: UnitedHealthcare | Provider ID: NPI-9842103411

To Medical Director / Prior Authorization Department,

We are submitting preliminary clinical documentation for Sarah Jenkins regarding a requested Lumbar Spine MRI (CPT 72148). The patient exhibits 8 weeks of radicular lower back pain with a positive straight leg raise on examination, and has completed an 8-week trial of high-dose NSAIDs (Ibuprofen 800mg TID).

Please note that while pharmacotherapy criteria are fulfilled, the patient has not yet completed the required 6-week course of formal physical therapy due to socioeconomic and scheduling constraints. We are initiating rapid outpatient PT enrollment or requesting a clinical review based on symptom severity.

Sincerely,
Attending Physician`,
      recommendation: 'Prior authorization will likely be denied without physical therapy records. Enroll patient in a 6-week physical therapy protocol or document specific clinical contraindications before submitting.'
    }
  }
];

export const PAYER_OPTIONS = [
  { id: 'aetna', name: 'Aetna Health (CPB 0236)' },
  { id: 'uhc', name: 'UnitedHealthcare (Policy 2024T0542)' },
  { id: 'cigna', name: 'Cigna Healthcare (Coverage Policy 0512)' },
  { id: 'anthem', name: 'Anthem / BCBS (CG-MED-73)' }
];
