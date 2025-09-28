import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/auth/validate
 *
 * Validates the provided server-side access token. Token may be provided via
 * Authorization: Bearer <token> header or an `access_token` cookie.
 *
 * Responses:
 * - 200: { ok: true } when token is valid and not expired
 * - 401: { error: 'Missing token' } / { error: 'Invalid token' } / { error: 'Token expired' }
 * - 500: { error: 'Server error' } on unexpected failures
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') ?? '';
    let token: string | null = null;
    if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim();

    // Fallback to cookie if Authorization header not present
    if (!token) {
      const cookie = request.headers.get('cookie') ?? '';
      const match = cookie.match(/(?:^|; )access_token=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

    // Lookup the token and ensure it maps to a user and isn't expired
    const dbToken = await prisma.accessToken.findUnique({ where: { token }, include: { user: true } });
    if (!dbToken || !dbToken.user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    if (dbToken.expiresAt && dbToken.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: 'Token expired' }, { status: 401 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('GET /api/auth/validate error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
