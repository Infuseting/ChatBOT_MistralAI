import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

/**
 * POST /api/auth/email/register
 *
 * Request body (JSON):
 * - email: string
 * - password: string
 * - name?: string (optional display name)
 *
 * Behavior:
 * - Validates required fields and checks for existing accounts.
 * - If an account already exists with a different provider, registration is rejected.
 * - Creates the user with a bcrypt-hashed password and assigns provider = 'MDP'.
 * - Creates an access token and returns it as an httpOnly cookie.
 *
 * Responses:
 * - 200: { ok: true } and access_token cookie on success
 * - 400: Missing fields or email already in use / provider mismatch
 * - 500: Server error on unexpected failures
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = (body.email as string | undefined)?.toLowerCase();
    const password = body.password as string | undefined;
    const name = body.name as string | undefined;

    // Require email and password
    if (!email || !password) return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });

    // Prevent registering an email already associated with another provider
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if ((existing as any).provider && (existing as any).provider !== 'MDP') {
        return NextResponse.json({ error: 'Account exists with different sign-in method' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Email already in use' }, { status: 400 });
    }

    // Hash the password and create the user
    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name: email.split('@')[0] || name || 'No name',
        provider: 'MDP',
      },
    });

    // Create an access token for the new user
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
    console.error('Email register error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
