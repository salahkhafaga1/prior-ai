import { NextRequest, NextResponse } from 'next/server';
import { deletePolicyDocument } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: 'Document ID is required' }, { status: 400 });
    }

    const success = await deletePolicyDocument(id);
    if (!success) {
      return NextResponse.json({ error: 'Failed to delete policy from database' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Policy deleted successfully' });
  } catch (err: any) {
    console.error('Error in delete policy route:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
