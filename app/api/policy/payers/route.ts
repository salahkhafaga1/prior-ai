import { NextResponse } from 'next/server';
import { fetchAvailablePayers, logDiagnostic, logDiagnosticError } from '@/lib/supabase';

export async function GET() {
  try {
    logDiagnostic('[SUPABASE LOG]', 'GET /api/policy/payers initiated...');
    const result = await fetchAvailablePayers();

    if (result.error) {
      return NextResponse.json(
        {
          success: false,
          source: result.error.source,
          errorCode: result.error.errorCode,
          message: result.error.message,
          details: result.error.details,
          payers: [],
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, payers: result.data || [] });
  } catch (error: any) {
    logDiagnosticError('[SUPABASE LOG]', 'Unhandled error in /api/policy/payers', error);
    return NextResponse.json(
      {
        success: false,
        source: '[Supabase DB]',
        errorCode: 'PAYERS_EXCEPTION',
        message: 'Failed to query payers from database.',
        details: error?.message || String(error),
        payers: [],
      },
      { status: 500 }
    );
  }
}
