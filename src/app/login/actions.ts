'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { passwordMatches, safeNextPath, SESSION_COOKIE, sessionToken } from '../lib/auth';

export interface LoginState {
  error: string | null;
}

export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) redirect('/');
  const given = form.get('password');
  if (typeof given !== 'string' || !passwordMatches(expected, given)) {
    return { error: 'That password is not right. Check APP_PASSWORD in your .env file.' };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sessionToken(expected), {
    httpOnly: true,
    sameSite: 'strict',
    // Only mark the cookie secure when the dashboard is actually served over HTTPS.
    secure: (await headers()).get('x-forwarded-proto') === 'https',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  const next = form.get('next');
  redirect(safeNextPath(typeof next === 'string' ? next : null));
}
