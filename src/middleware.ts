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

    if (res.status !== 200) {
      console.warn('[Middleware] Token invalide ou expiré');
      return NextResponse.redirect(new URL('/login', req.url));
    }

    console.log('[Middleware] Auth OK');
    return NextResponse.next();
  } catch (error) {
    console.error('[Middleware] Erreur de validation', error);
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = {
  matcher: [
    '/((?!api|login|_next|public|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|ico|woff|woff2|ttf|eot)).*)',
  ],
};
