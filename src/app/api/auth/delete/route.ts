import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(request: Request) {
  try {
    // find token from cookie or Authorization header
    const authHeader = request.headers.get('authorization') ?? '';
    let token: string | null = null;
    if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim();
    if (!token) {
      const cookie = request.headers.get('cookie') ?? '';
      const match = cookie.match(/(?:^|; )access_token=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 401 });

    const dbToken = await prisma.accessToken.findUnique({ where: { token } });
    if (!dbToken) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const userId = dbToken.userId;

    // delete related data in proper order (messages, threads, shares, tokens, user)
    await prisma.message.deleteMany({ where: { thread: { userId } } });
    await prisma.thread.deleteMany({ where: { userId } });
    await prisma.share.deleteMany({ where: { userId } });
    await prisma.accessToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });

    const res = NextResponse.json({ ok: true });
    res.cookies.set('access_token', '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    console.error('Account delete error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
