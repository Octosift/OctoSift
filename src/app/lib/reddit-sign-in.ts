import 'server-only';
/**
 * "Sign in with a browser window": opens a real Chromium window on Reddit's
 * sign-in page, lets the user sign in themselves, and takes the session
 * cookies once Reddit sets them. The app never sees the password.
 *
 * Only works where the app runs on the user's own machine with a screen; in
 * a container the user pastes the cookie instead.
 */
import { existsSync } from 'node:fs';
import { CONFIG } from '@/core/config';
import type { ConnectResult } from '@/core/reddit/account';
import { watchSignIn, type SignInBrowser } from './sign-in-watch';

export type SignInState =
  | { status: 'idle' }
  | { status: 'waiting'; startedAt: number }
  | { status: 'connected'; username: string | null }
  | { status: 'failed'; message: string };

let state: SignInState = { status: 'idle' };

export function signInState(): SignInState {
  return state;
}

/** True inside Docker or another container, where no window can be opened. */
export function runsInContainer(): boolean {
  return process.env.IN_CONTAINER === '1' || existsSync('/.dockerenv');
}

export async function startSignIn(
  connect: (cookie: string) => Promise<ConnectResult>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (runsInContainer()) {
    return {
      ok: false,
      message:
        'Signing in with a browser window only works when the app runs on your own computer, not in Docker. Paste the cookie instead.',
    };
  }
  if (state.status === 'waiting') return { ok: true };
  let browser: SignInBrowser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: false });
  } catch {
    return {
      ok: false,
      message:
        'Could not open a browser window. Run "pnpm exec playwright install chromium" once, or paste the cookie instead.',
    };
  }
  state = { status: 'waiting', startedAt: Date.now() };
  void watchSignIn(browser, connect, { timeoutMs: CONFIG.session.signInTimeoutMs }).then(
    (result) => {
      state = result;
    },
  );
  return { ok: true };
}
