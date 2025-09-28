import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/auth/google/token
 *
 * Accepts a Google OAuth access_token issued by the client and verifies it
 * using Google's tokeninfo endpoint. On success, the user is upserted by
 * googleId and a local server-side access token is issued (set as cookie).
 *
 * Request body (JSON):
 * - access_token: string (Google access token obtained on the client)
 *
 * Responses:
 * - 200: { ok: true } and access_token cookie set (server token)
 * - 400: { error: 'Missing access_token' } or { error: 'Invalid token payload' }
 * - 401: { error: 'Invalid access_token' } when Google rejects the token
 * - 500: { error: 'Server error' } on unexpected failures
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const access_token = body.access_token as string | undefined;
    if (!access_token) return NextResponse.json({ error: 'Missing access_token' }, { status: 400 });

    // Verify access_token with Google's tokeninfo endpoint
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access_token)}`);
    if (!verifyRes.ok) return NextResponse.json({ error: 'Invalid access_token' }, { status: 401 });
    const payload = await verifyRes.json();

    const sub = payload.sub as string | undefined; // Google subject (unique id)
    const email = payload.email as string | undefined;
    const name = payload.name as string | undefined;
    const picture = payload.picture as string | undefined;

    if (!sub) return NextResponse.json({ error: 'Invalid token payload' }, { status: 400 });

    // If an account already exists with this email but a different provider, reject
    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && (existing as any).provider && (existing as any).provider !== 'GOOGLE') {
        return NextResponse.json({ error: 'Account exists with different sign-in method' }, { status: 400 });
      }
    }

    // Upsert user by googleId and ensure provider is set to 'GOOGLE'
    const user = await prisma.user.upsert({
      where: { googleId: sub },
      update: {
        name: name ?? undefined,
        email: email ?? undefined,
        avatar: picture ?? undefined,
        provider: 'GOOGLE',
      },
      create: {
        name: name ?? 'No name',
        email: email ?? undefined,
        avatar: picture ?? undefined,
        googleId: sub,
        provider: 'GOOGLE',
      },
    });

    // Create a server-side access token (local token, not Google's)
    const serverToken = typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random()}`;
    const dbToken = await prisma.accessToken.create({
      data: {
        token: serverToken,
        userId: user.id,
      },
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set('access_token', dbToken.token, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return res;
  } catch (err) {
    console.error('Google token exchange error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
