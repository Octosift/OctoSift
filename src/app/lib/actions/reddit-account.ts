'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  connectSession,
  disconnectSession,
  normalizeCookieHeader,
  type ConnectResult,
} from '@/core/reddit/account';
import { createRateLimiter } from '@/core/reddit/ratelimit';
import { createSessionClient } from '@/core/reddit/session-client';
import { signInState, startSignIn, type SignInState } from '../reddit-sign-in';
import { getRuntime, nowSeconds } from '../runtime';

export type AccountActionResult = { ok: true } | { ok: false; error: string };

/** Checks a cookie with its own short-lived client and stores it when Reddit accepts it. */
async function connect(cookie: string): Promise<ConnectResult> {
  const runtime = getRuntime();
  const client = createSessionClient({
    cookie: () => cookie,
    userAgent: () => runtime.settings.get('reddit.userAgent'),
    limiter: createRateLimiter({
      clock: runtime.clock,
      random: runtime.random,
      minSpacingMs: 1_000,
      maxJitterMs: 500,
      maxWaitMs: 10_000,
    }),
    clock: runtime.clock,
    onInvalid: () => undefined,
  });
  const result = await connectSession(
    { db: runtime.db, secrets: runtime.secrets, now: nowSeconds() },
    cookie,
    client,
  );
  if (result.ok) {
    revalidatePath('/settings');
    revalidatePath('/', 'layout');
  }
  return result;
}

export async function connectWithCookie(input: { cookie: string }): Promise<AccountActionResult> {
  const parsed = z.object({ cookie: z.string().max(16_000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That is too long to be a cookie header.' };
  const cookie = normalizeCookieHeader(parsed.data.cookie);
  if (!cookie) {
    return {
      ok: false,
      error:
        'This does not look like the cookie of a signed-in Reddit session (no reddit_session in it).',
    };
  }
  const result = await connect(cookie);
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

export async function startBrowserSignIn(): Promise<AccountActionResult> {
  const result = await startSignIn(connect);
  return result.ok ? { ok: true } : { ok: false, error: result.message };
}

export async function browserSignInStatus(): Promise<SignInState> {
  return Promise.resolve(signInState());
}

export async function disconnectReddit(): Promise<AccountActionResult> {
  const { db, secrets } = getRuntime();
  disconnectSession(db, secrets);
  revalidatePath('/settings');
  revalidatePath('/', 'layout');
  return Promise.resolve({ ok: true });
}
