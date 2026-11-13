'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  createLoginThrottle,
  passwordMatches,
  safeNextPath,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  sessionToken,
} from '../lib/auth';

export interface LoginState {
  error: string | null;
}

// Shared by every client of this server process, so guessing from many addresses is slowed too.
const throttle = createLoginThrottle({ maxFailures: 10, windowMs: 60_000 });

export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) redirect('/');
  const nowMs = Date.now();
  if (throttle.blocked(nowMs)) {
    return { error: 'Too many wrong passwords. Wait a minute and try again.' };
  }
  const given = form.get('password');
  if (typeof given !== 'string' || !passwordMatches(expected, given)) {
    throttle.fail(nowMs);
    return { error: 'That password is not right. Check APP_PASSWORD in your .env file.' };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionToken(expected, Math.floor(nowMs / 1000)), {
    httpOnly: true,
    sameSite: 'strict',
    // Only mark the cookie secure when the dashboard is actually served over HTTPS.
    secure: (await headers()).get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  const next = form.get('next');
  redirect(safeNextPath(typeof next === 'string' ? next : null));
}
