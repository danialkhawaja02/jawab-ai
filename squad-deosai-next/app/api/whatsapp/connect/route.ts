import { NextResponse } from 'next/server';
import { initializeWhatsAppClient, getWhatsAppStatus } from '@/lib/whatsapp/client';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { whatsappConnectSchema } from '@/lib/validations/api';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // Optional body validation
    try {
      const rawBody = await request.json();
      const parseResult = whatsappConnectSchema.safeParse(rawBody);
      if (!parseResult.success) {
        return NextResponse.json(
          { error: parseResult.error.issues[0].message, details: parseResult.error.issues },
          { status: 400 }
        );
      }
    } catch {
      // Body is optional, ignore JSON parse error if it's empty
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentState = getWhatsAppStatus(user.id);
    if (currentState.status === 'disconnected') {
      // Start initialization in background, don't await because it blocks until ready/qr
      initializeWhatsAppClient(user.id).catch(console.error);
    }

    return NextResponse.json({ success: true, status: getWhatsAppStatus(user.id).status });
  } catch (error) {
    logger.error('[WhatsApp Connect API Error]', { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
