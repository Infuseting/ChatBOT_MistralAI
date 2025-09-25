import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  try {
    const access_token = request.headers.get('authorization')?.split(' ')[1] || (await cookies()).get('access_token')?.value;
    if (!access_token) return NextResponse.json({ error: 'Missing access_token' }, { status: 400 });
    await prisma.accessToken.deleteMany({ where: { token: access_token } });
    const res = NextResponse.json({ ok: true });
    res.cookies.set('access_token', '', { httpOnly: true });
    return res;
  } catch (err) {
    console.error('Google token exchange error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
