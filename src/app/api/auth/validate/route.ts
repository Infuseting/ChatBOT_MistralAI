import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') ?? '';
    let token: string | null = null;
    if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim();

    if (!token) {
      const cookie = request.headers.get('cookie') ?? '';
      const match = cookie.match(/(?:^|; )access_token=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

    const dbToken = await prisma.accessToken.findUnique({ where: { token }, include: { user: true } });
    if (!dbToken || !dbToken.user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    if (dbToken.expiresAt && dbToken.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: 'Token expired' }, { status: 401 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('GET /api/auth/validate error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
