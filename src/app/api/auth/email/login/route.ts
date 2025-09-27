import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = (body.email as string | undefined)?.toLowerCase();
    const password = body.password as string | undefined;

    if (!email || !password) return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    // If the user exists but was created with a different provider, reject
    if ((user as any).provider && (user as any).provider !== 'MDP') {
      return NextResponse.json({ error: 'Account exists with different sign-in method' }, { status: 400 });
    }

    const ok = await bcrypt.compare(password, user.password as string);
    if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    const serverToken = typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random()}`;
    const dbToken = await prisma.accessToken.create({ data: { token: serverToken, userId: user.id } });

    const res = NextResponse.json({ ok: true });
    res.cookies.set('access_token', dbToken.token, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return res;
  } catch (err) {
    console.error('Email login error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
