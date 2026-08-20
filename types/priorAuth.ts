export type AuthStatus = 'APPROVED' | 'ACTION_REQUIRED' | 'REJECTED';

export interface CriteriaCheckitem {
  requirement: string;
  met: boolean;
  evidenceOrNote: string;
}

export interface PolicyCitation {
  payerName: string;
  policyDocument: string;
  clauseSection: string;
  exactTextSnippet: string;
}

export interface PriorAuthResponse {
  status: AuthStatus;
  matchScore: number; // Percentage 0 - 100
  checklist: CriteriaCheckitem[];
  missingRequirements: string[];
  citation: PolicyCitation;
  justificationLetter: string;
  recommendation: string;
}

export interface PriorAuthRequest {
  patientNote: string;
  payerId: string;
  procedureRequested?: string;
}

export interface MockCase {
  id: string;
  title: string;
  patientName: string;
  patientAge: number;
  patientGender: string;
  payerId: string;
  payerName: string;
  procedureRequested: string;
  clinicalNote: string;
  expectedResult: PriorAuthResponse;
}
