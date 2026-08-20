import { NextResponse } from 'next/server';
import { fetchAllPolicies, logDiagnostic, logDiagnosticError } from '@/lib/supabase';

export async function GET() {
  try {
    logDiagnostic('[SUPABASE LOG]', 'GET /api/policy/list initiated...');
    const result = await fetchAllPolicies();

    if (result.error) {
      return NextResponse.json(
        {
          success: false,
          source: result.error.source,
          errorCode: result.error.errorCode,
          message: result.error.message,
          details: result.error.details,
          policies: [],
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, policies: result.data || [] });
  } catch (error: any) {
    logDiagnosticError('[SUPABASE LOG]', 'Unhandled error in /api/policy/list', error);
    return NextResponse.json(
      {
        success: false,
        source: '[Supabase DB]',
        errorCode: 'LIST_EXCEPTION',
        message: 'Failed to fetch policies from database.',
        details: error?.message || String(error),
        policies: [],
      },
      { status: 500 }
    );
  }
}
