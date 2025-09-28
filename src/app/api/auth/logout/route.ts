import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';

/**
 * POST /api/auth/logout
 *
 * Logs out the current user by deleting the server-side access token and
 * clearing the `access_token` cookie.
 *
 * Token sources supported:
 * - Authorization: Bearer <token>
 * - access_token cookie
 *
 * Responses:
 * - 200: { ok: true } on success
 * - 400: { error: 'Missing access_token' } when no token supplied
 * - 500: { error: 'Server error' } on unexpected failures
 */
export async function POST(request: Request) {
  try {
    // Prefer Authorization header, fallback to cookie
    const access_token = request.headers.get('authorization')?.split(' ')[1] || (await cookies()).get('access_token')?.value;
    if (!access_token) return NextResponse.json({ error: 'Missing access_token' }, { status: 400 });

    // Remove the server-side token(s) associated with this value
    await prisma.accessToken.deleteMany({ where: { token: access_token } });

    const res = NextResponse.json({ ok: true });
    // Clear the cookie by setting an empty value and an expired date
    res.cookies.set('access_token', '', {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: new Date(0),
    });
    return res;
  } catch (err) {
    console.error('Logout error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
