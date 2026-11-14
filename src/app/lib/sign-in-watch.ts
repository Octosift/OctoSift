/**
 * Waits in an open browser window for the user to sign in to Reddit, then
 * hands the session cookies to `connect` and closes the window.
 */
import type { ConnectResult } from '@/core/reddit/account';

export interface SignInBrowser {
  isConnected(): boolean;
  close(): Promise<void>;
  newContext(): Promise<{
    newPage(): Promise<{ goto(url: string): Promise<unknown> }>;
    cookies(url: string): Promise<{ name: string; value: string }[]>;
  }>;
}

export type SignInOutcome =
  { status: 'connected'; username: string | null } | { status: 'failed'; message: string };

export async function watchSignIn(
  browser: SignInBrowser,
  connect: (cookie: string) => Promise<ConnectResult>,
  options: { timeoutMs: number; pollMs?: number; now?: () => number },
): Promise<SignInOutcome> {
  const now = options.now ?? (() => Date.now());
  const pollMs = options.pollMs ?? 1_000;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://www.reddit.com/login/');
    const deadline = now() + options.timeoutMs;
    while (now() < deadline && browser.isConnected()) {
      const cookies = await context.cookies('https://www.reddit.com');
      if (cookies.some((cookie) => cookie.name === 'reddit_session' && cookie.value)) {
        const header = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
        await browser.close();
        const result = await connect(header);
        return result.ok
          ? { status: 'connected', username: result.username }
          : { status: 'failed', message: result.message };
      }
      await new Promise((resolve) => {
        setTimeout(resolve, pollMs);
      });
    }
    return {
      status: 'failed',
      message: browser.isConnected()
        ? 'Signing in took too long, so the window was closed. Try again.'
        : 'The window was closed before signing in.',
    };
  } catch {
    // Details could include page content; the user only needs to know it stopped.
    return { status: 'failed', message: 'The sign-in window stopped unexpectedly. Try again.' };
  } finally {
    if (browser.isConnected()) await browser.close().catch(() => undefined);
  }
}
