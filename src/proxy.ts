/**
 * Runs before every request. Without APP_PASSWORD it does nothing (the
 * server only listens on 127.0.0.1 by default). With it, requests need the
 * session cookie set by the login page.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isValidSession, SESSION_COOKIE } from './app/lib/auth';

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (pathname === '/login') return NextResponse.next();
  if (isValidSession(password, request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
