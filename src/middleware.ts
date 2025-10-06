// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  try {
    const res = await fetch(`${req.nextUrl.origin}/api/auth/validate`, {
      headers: {
        cookie: req.headers.get('cookie') || '',
      },
    });

    // If token is valid, continue normally.
    if (res.status === 200) {
      console.log('[Middleware] Auth OK');
      // If the user is authenticated, ensure we clear any previous guest
      // marker so subsequent client checks don't mistakenly treat as guest.
      const resp = NextResponse.next();
      try {
        // Remove the cookie by setting it with Max-Age=0
        resp.headers.set('set-cookie', 'is_guest=; Path=/; Max-Age=0; SameSite=Lax');
      } catch (e) {}
      return resp;
    }

    // If token is missing/invalid, allow the request to continue but mark
    // the visitor as a guest by setting a non-httpOnly cookie the client
    // can read. We DO NOT redirect to /login anymore so guest users can
    // interact with the app. Guest threads must remain ephemeral (handled
    // in client code).
    console.warn('[Middleware] No valid token — treating as guest');
    const resp = NextResponse.next();
    // Set a client-readable guest cookie so frontend can quickly detect guest
    // sessions. Keep it simple and non-sensitive.
    try {
      resp.headers.set('set-cookie', 'is_guest=1; Path=/; SameSite=Lax');
    } catch (e) {
      // ignore header set errors and just continue
    }
    return resp;
  } catch (error) {
    console.error('[Middleware] Erreur de validation', error);
    const resp = NextResponse.next();
    try { resp.headers.set('set-cookie', 'is_guest=1; Path=/; SameSite=Lax'); } catch (e) {}
    return resp;
  }
}

export const config = {
  matcher: [
    '/((?!api|login|_next|public|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|ico|woff|woff2|ttf|eot)).*)',
  ],
};
