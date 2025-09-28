import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

/**
 * POST /api/auth/email/login
 *
 * Request body (JSON):
 * - email: string (user email)
 * - password: string (plain-text password)
 *
 * Response:
 * - 200: { ok: true } and an httpOnly `access_token` cookie on successful login
 * - 400: { error: 'Missing email or password' } when required fields are missing
 * - 400: { error: 'Account exists with different sign-in method' } when provider mismatch
 * - 401: { error: 'Invalid credentials' } when authentication fails
 * - 500: { error: 'Server error' } on unexpected failures
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = (body.email as string | undefined)?.toLowerCase();
    const password = body.password as string | undefined;

    // Validate required fields
    if (!email || !password) return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });

    // Find the user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    // If the user was created with a different provider (e.g., Google), reject
    if ((user as any).provider && (user as any).provider !== 'MDP') {
      return NextResponse.json({ error: 'Account exists with different sign-in method' }, { status: 400 });
    }

    // Compare provided password with the stored bcrypt hash
    const ok = await bcrypt.compare(password, user.password as string);
    if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

    // Generate a server-side token and persist it in the DB
    const serverToken = typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `${Date.now()}-${Math.random()}`;
    const dbToken = await prisma.accessToken.create({ data: { token: serverToken, userId: user.id } });

    // Return success and set a secure httpOnly cookie for subsequent requests
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
