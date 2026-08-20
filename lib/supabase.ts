import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let supabaseInstance: SupabaseClient | null = null;

export interface DiagnosticError {
  source: '[Supabase DB]' | '[Gemini API]' | '[RAG Pipeline]' | '[Policy Uploader]';
  errorCode: string;
  message: string;
  details?: string;
}

export function logDiagnostic(
  source: '[SUPABASE LOG]' | '[GEMINI API LOG]' | '[RAG ENGINE LOG]' | '[UPLOAD LOG]' | '[IMAGE LOG]',
  message: string,
  data?: any
) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`${source} [${timestamp}] ${message}`, data);
  } else {
    console.log(`${source} [${timestamp}] ${message}`);
  }
}

export function logDiagnosticError(
  source: '[SUPABASE LOG]' | '[GEMINI API LOG]' | '[RAG ENGINE LOG]' | '[UPLOAD LOG]' | '[IMAGE LOG]',
  message: string,
  error?: any
) {
  const timestamp = new Date().toISOString();
  console.error(`${source} [${timestamp}] ERROR: ${message}`, error?.message || error || '');
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('your-supabase-url')) {
    logDiagnostic('[SUPABASE LOG]', 'Supabase credentials not configured in environment.');
    return null;
  }
  if (!supabaseInstance) {
    try {
      supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
      });
      logDiagnostic('[SUPABASE LOG]', 'Supabase client connected successfully.');
    } catch (err: any) {
      logDiagnosticError('[SUPABASE LOG]', 'Failed to initialize Supabase client', err);
      return null;
    }
  }
  return supabaseInstance;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('your-supabase-url') &&
    supabaseUrl.startsWith('http')
  );
}

export interface PolicyDocument {
  id?: string;
  payer: string;
  title: string;
  procedure_type?: string;
  clause_section?: string;
  content: string;
  created_at?: string;
}

export interface SupabaseQueryResult<T> {
  data: T | null;
  error: DiagnosticError | null;
}

/**
 * Filter out raw binary/stream PDF corrupted text.
 */
function isRowClean(doc: PolicyDocument): boolean {
  if (!doc.content || typeof doc.content !== 'string') return false;
  const trimmed = doc.content.trim();
  if (trimmed.length < 50) return false;
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

/**
 * Fetch all available policy documents from Supabase policy_documents table.
 */
export async function fetchAllPolicies(): Promise<SupabaseQueryResult<PolicyDocument[]>> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      data: [],
      error: {
        source: '[Supabase DB]',
        errorCode: 'SUPABASE_UNCONFIGURED',
        message: 'Supabase URL or Anon Key is missing in .env.local.',
        details: 'Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      },
    };
  }

  try {
    logDiagnostic('[SUPABASE LOG]', 'Querying all policies from policy_documents table...');
    const { data, error } = await supabase
      .from('policy_documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logDiagnosticError('[SUPABASE LOG]', 'Failed querying policy_documents', error);
      return {
        data: [],
        error: {
          source: '[Supabase DB]',
          errorCode: 'SUPABASE_FETCH_FAILED',
          message: error.message || 'Failed to retrieve policy documents from database.',
          details: `Code: ${error.code || 'UNKNOWN'}`,
        },
      };
    }

    const cleanRows = ((data as PolicyDocument[]) || []).filter(isRowClean);
    logDiagnostic('[SUPABASE LOG]', `Retrieved ${cleanRows.length} valid policies from database.`);
    return { data: cleanRows, error: null };
  } catch (err: any) {
    logDiagnosticError('[SUPABASE LOG]', 'Exception fetching policies', err);
    return {
      data: [],
      error: {
        source: '[Supabase DB]',
        errorCode: 'SUPABASE_NETWORK_EXCEPTION',
        message: err?.message || 'Network exception connecting to Supabase.',
        details: String(err?.stack || err),
      },
    };
  }
}

/**
 * Fetch distinct payer names currently present in Supabase policy_documents table.
 */
export async function fetchAvailablePayers(): Promise<SupabaseQueryResult<string[]>> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      data: [],
      error: {
        source: '[Supabase DB]',
        errorCode: 'SUPABASE_UNCONFIGURED',
        message: 'Supabase credentials missing.',
        details: 'Verify NEXT_PUBLIC_SUPABASE_URL in .env.local',
      },
    };
  }

  try {
    logDiagnostic('[SUPABASE LOG]', 'Querying distinct payers from policy_documents...');
    const { data, error } = await supabase
      .from('policy_documents')
      .select('*')
      .order('payer', { ascending: true });

    if (error) {
      logDiagnosticError('[SUPABASE LOG]', 'Failed to query payers', error);
      return {
        data: [],
        error: {
          source: '[Supabase DB]',
          errorCode: 'SUPABASE_PAYER_QUERY_FAILED',
          message: error.message || 'Failed to query payers from policy_documents table.',
          details: `Error Code: ${error.code || 'UNKNOWN'}`,
        },
      };
    }

    // Only include payers with clean, non-corrupted content
    const cleanPayers = Array.from(
      new Set(
        ((data as PolicyDocument[]) || [])
          .filter(isRowClean)
          .map((item) => item.payer?.trim())
      )
    ).filter(Boolean);

    logDiagnostic('[SUPABASE LOG]', `Distinct clean payers found (${cleanPayers.length}):`, cleanPayers);
    return { data: cleanPayers, error: null };
  } catch (err: any) {
    logDiagnosticError('[SUPABASE LOG]', 'Exception fetching payers', err);
    return {
      data: [],
      error: {
        source: '[Supabase DB]',
        errorCode: 'SUPABASE_EXCEPTION',
        message: err?.message || 'Database connection error.',
        details: String(err?.stack || err),
      },
    };
  }
}

/**
 * Search policy documents for a specific payer in Supabase.
 */
export async function searchPayerPolicies(payerTag: string): Promise<SupabaseQueryResult<PolicyDocument[]>> {
  const normalizedPayer = payerTag.toLowerCase().replace('@', '').trim();
  const supabase = getSupabaseClient();

  if (!supabase) {
    return {
      data: [],
      error: {
        source: '[Supabase DB]',
        errorCode: 'SUPABASE_UNCONFIGURED',
        message: 'Supabase credentials are not configured in environment.',
        details: 'Check NEXT_PUBLIC_SUPABASE_URL in .env.local',
      },
    };
  }

  try {
    logDiagnostic('[SUPABASE LOG]', `Searching policy documents for payer: "${normalizedPayer}"...`);
    const { data, error } = await supabase
      .from('policy_documents')
      .select('*')
      .ilike('payer', `%${normalizedPayer}%`)
      .order('created_at', { ascending: false });

    if (error) {
      logDiagnosticError('[SUPABASE LOG]', `Policy search failed for: ${normalizedPayer}`, error);
      return {
        data: [],
        error: {
          source: '[Supabase DB]',
          errorCode: 'SUPABASE_SEARCH_FAILED',
          message: error.message || `Failed to search policy documents for ${normalizedPayer}.`,
          details: `Postgres Code: ${error.code}`,
        },
      };
    }

    return { data: (data as PolicyDocument[]) || [], error: null };
  } catch (err: any) {
    logDiagnosticError('[SUPABASE LOG]', `Search exception for: ${normalizedPayer}`, err);
    return {
      data: [],
      error: {
        source: '[Supabase DB]',
        errorCode: 'SUPABASE_SEARCH_EXCEPTION',
        message: err?.message || 'Database search execution failed.',
        details: String(err?.stack || err),
      },
    };
  }
}

/**
 * Insert or save an uploaded policy document directly into live Supabase policy_documents table.
 */
export async function storePolicyDocument(doc: PolicyDocument): Promise<SupabaseQueryResult<PolicyDocument>> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      data: null,
      error: {
        source: '[Supabase DB]',
        errorCode: 'SUPABASE_UNCONFIGURED',
        message: 'Cannot insert policy: Supabase client not initialized.',
        details: 'Verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local',
      },
    };
  }

  try {
    logDiagnostic('[UPLOAD LOG]', `Inserting clean policy document for payer "${doc.payer}"...`);
    const { data, error } = await supabase
      .from('policy_documents')
      .insert({
        payer: doc.payer.trim(),
        title: doc.title.trim(),
        procedure_type: doc.procedure_type?.trim() || 'General Policy',
        clause_section: doc.clause_section?.trim() || 'Section 1.0',
        content: doc.content.trim(),
      })
      .select();

    if (error) {
      logDiagnosticError('[UPLOAD LOG]', 'Supabase insert failed', error);
      return {
        data: null,
        error: {
          source: '[Policy Uploader]',
          errorCode: 'SUPABASE_INSERT_FAILED',
          message: error.message || 'Failed to insert policy record into Supabase.',
          details: `Error Code: ${error.code || 'UNKNOWN'}`,
        },
      };
    }

    return { data: data?.[0] as PolicyDocument, error: null };
  } catch (err: any) {
    logDiagnosticError('[UPLOAD LOG]', 'Exception during policy insertion', err);
    return {
      data: null,
      error: {
        source: '[Policy Uploader]',
        errorCode: 'SUPABASE_INSERT_EXCEPTION',
        message: err?.message || 'Unexpected exception during policy insertion.',
        details: String(err?.stack || err),
      },
    };
  }
}

/**
 * Delete a policy document from Supabase.
 */
export async function deletePolicyDocument(id: string): Promise<SupabaseQueryResult<boolean>> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      data: false,
      error: {
        source: '[Supabase DB]',
        errorCode: 'SUPABASE_UNCONFIGURED',
        message: 'Supabase client not initialized.',
      },
    };
  }

  try {
    logDiagnostic('[SUPABASE LOG]', `Deleting policy document ID: ${id}...`);
    const { error } = await supabase
      .from('policy_documents')
      .delete()
      .eq('id', id);

    if (error) {
      logDiagnosticError('[SUPABASE LOG]', `Failed to delete policy ID: ${id}`, error);
      return {
        data: false,
        error: {
          source: '[Supabase DB]',
          errorCode: 'SUPABASE_DELETE_FAILED',
          message: error.message || 'Failed to delete policy document.',
          details: `Error Code: ${error.code || 'UNKNOWN'}`,
        },
      };
    }

    logDiagnostic('[SUPABASE LOG]', `Policy ID: ${id} deleted successfully.`);
    return { data: true, error: null };
  } catch (err: any) {
    logDiagnosticError('[SUPABASE LOG]', `Exception deleting policy ID: ${id}`, err);
    return {
      data: false,
      error: {
        source: '[Supabase DB]',
        errorCode: 'SUPABASE_DELETE_EXCEPTION',
        message: err?.message || 'Exception during deletion.',
        details: String(err?.stack || err),
      },
    };
  }
}
