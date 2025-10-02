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
    let sub = payload.sub as string | undefined; // Google subject (unique id)
    let email = payload.email as string | undefined;
    let name = payload.name as string | undefined;
    let picture = payload.picture as string | undefined;

    // If tokeninfo doesn't return profile fields like name or picture, fetch the userinfo endpoint as a fallback
    if ((!name || !picture) && access_token) {
      try {
        const userinfoRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${encodeURIComponent(access_token)}`);
        if (userinfoRes.ok) {
          const ui = await userinfoRes.json();
          // Only overwrite missing fields
          if (!name && ui.name) name = ui.name as string;
          if (!picture && (ui.picture || ui.avatar)) picture = (ui.picture || ui.avatar) as string;
          if (!email && ui.email) email = ui.email as string;
        } else {
          console.log('Google userinfo fallback failed', userinfoRes.status, await userinfoRes.text());
        }
      } catch (e) {
        console.error('Error fetching Google userinfo fallback', e);
      }
    }

    if (!sub) return NextResponse.json({ error: 'Invalid token payload' }, { status: 400 });

    // If an account already exists with this email but a different provider, reject
    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && (existing as any).provider && (existing as any).provider !== 'GOOGLE') {
        return NextResponse.json({ error: 'Account exists with different sign-in method' }, { status: 400 });
      }
    }
    const updateData: any = { provider: 'GOOGLE' };
    if (typeof name !== 'undefined' && name !== null) updateData.name = name;
    if (typeof email !== 'undefined' && email !== null) updateData.email = email;
    if (typeof picture !== 'undefined' && picture !== null) updateData.avatar = picture;

    const user = await prisma.user.upsert({
      where: { googleId: sub },
      update: updateData,
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
