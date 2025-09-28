import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * DELETE /api/auth/delete
 *
 * Deletes the current authenticated user's account and all related data.
 *
 * Authentication:
 * - The endpoint accepts a Bearer token in the Authorization header, or
 *   an `access_token` cookie.
 *
 * Behavior:
 * - Validates the token and looks up the associated user.
 * - Deletes messages, threads, shares, access tokens, and finally the user record.
 * - Clears the `access_token` cookie in the response.
 *
 * Responses:
 * - 200: { ok: true } on success (cookie cleared)
 * - 401: { error: 'Missing token' } or { error: 'Invalid token' } when auth fails
 * - 500: { error: 'Server error' } on unexpected failures
 *
 * Note: This operation is destructive and irreversible. The route performs
 * cascade-like deletes in a safe order to avoid foreign key constraint errors.
 */
export async function DELETE(request: Request) {
  try {
    // Try to extract the bearer token from the Authorization header first
    const authHeader = request.headers.get('authorization') ?? '';
    let token: string | null = null;
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    }

    // If no Authorization header token, attempt to read the access_token cookie
    if (!token) {
      const cookie = request.headers.get('cookie') ?? '';
      // Match cookie like: access_token=the-token-value
      const match = cookie.match(/(?:^|; )access_token=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    // If still no token, return 401 Unauthorized
    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

    // Validate the token against the database
    const dbToken = await prisma.accessToken.findUnique({ where: { token } });
    if (!dbToken) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const userId = dbToken.userId;

    // Delete user-related data in an order that respects FK constraints:
    // messages -> threads -> shares -> tokens -> user
    await prisma.message.deleteMany({ where: { thread: { userId } } });
    await prisma.thread.deleteMany({ where: { userId } });
    await prisma.share.deleteMany({ where: { userId } });
    await prisma.accessToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });

    // Return success and clear the cookie on the client
    const res = NextResponse.json({ ok: true });
    res.cookies.set('access_token', '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    // Log the error server-side for debugging; do not leak internal details to clients
    console.error('Account delete error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
