import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const access_token = body.access_token as string | undefined;
    if (!access_token) return NextResponse.json({ error: 'Missing access_token' }, { status: 400 });

    // Verify access_token with Google
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access_token)}`);
    if (!verifyRes.ok) return NextResponse.json({ error: 'Invalid access_token' }, { status: 401 });
    const payload = await verifyRes.json();

    const sub = payload.sub as string | undefined;
    const email = payload.email as string | undefined;
    const name = payload.name as string | undefined;
    const picture = payload.picture as string | undefined;

    if (!sub) return NextResponse.json({ error: 'Invalid token payload' }, { status: 400 });

    // If a user with this email exists but uses a different provider, reject
    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && (existing as any).provider && (existing as any).provider !== 'GOOGLE') {
        return NextResponse.json({ error: 'Account exists with different sign-in method' }, { status: 400 });
      }
    }

    // Upsert user by googleId; set provider to google
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

    // Create a server-side access token (not the Google access token)
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
