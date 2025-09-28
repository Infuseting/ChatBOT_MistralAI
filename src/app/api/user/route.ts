import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/user
 *
 * Returns basic profile information for the authenticated user. The server-side
 * access token may be provided in the Authorization header or as an access_token cookie.
 *
 * Response (200): { id, name, picture? }
 * Error responses: 401 when token is missing/invalid/expired, 500 on server errors
 */
export async function GET(request: Request) {
	try {
		const authHeader = request.headers.get('authorization') ?? '';
		let token: string | null = null;
		if (authHeader.toLowerCase().startsWith('bearer ')) {
			token = authHeader.slice(7).trim();
		}

		// Fallback to read cookie if Authorization header absent
		if (!token) {
			const cookie = request.headers.get('cookie') ?? '';
			const match = cookie.match(/(?:^|; )access_token=([^;]+)/);
			if (match) token = decodeURIComponent(match[1]);
		}

		if (!token) {
			return NextResponse.json({ error: 'Missing token' }, { status: 401 });
		}

		const dbToken = await prisma.accessToken.findUnique({ where: { token }, include: { user: true } });
		if (!dbToken || !dbToken.user) {
			return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
		}
		if (dbToken.expiresAt && dbToken.expiresAt.getTime() < Date.now()) {
			return NextResponse.json({ error: 'Token expired' }, { status: 401 });
		}

		const user = dbToken.user;

		const out = {
			id: user.id,
			name: user.name,
			picture: user.avatar ?? undefined,
		};

		return NextResponse.json(out, { status: 200 });
	} catch (err) {
		console.error('GET /api/user error', err);
		return NextResponse.json({ error: 'Server error' }, { status: 500 });
	}
}

