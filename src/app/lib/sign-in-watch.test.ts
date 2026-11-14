import { describe, expect, it } from 'vitest';
import { watchSignIn, type SignInBrowser } from './sign-in-watch';

/** A fake window whose cookies change after a number of polls. */
function fakeBrowser(cookiesAfter: { polls: number; cookies: { name: string; value: string }[] }) {
  let polls = 0;
  let open = true;
  const visited: string[] = [];
  const browser: SignInBrowser = {
    isConnected: () => open,
    close: () => {
      open = false;
      return Promise.resolve();
    },
    newContext: () =>
      Promise.resolve({
        newPage: () =>
          Promise.resolve({
            goto: (url: string) => {
              visited.push(url);
              return Promise.resolve();
            },
          }),
        cookies: () => {
          polls += 1;
          return Promise.resolve(polls > cookiesAfter.polls ? cookiesAfter.cookies : []);
        },
      }),
  };
  return { browser, visited, isOpen: () => open };
}

describe('watchSignIn', () => {
  it('opens the sign-in page and connects with the cookies once the session appears', async () => {
    const { browser, visited, isOpen } = fakeBrowser({
      polls: 2,
      cookies: [
        { name: 'loid', value: 'synthetic-loid' },
        { name: 'reddit_session', value: 'synthetic-session' },
      ],
    });
    const received: string[] = [];
    const outcome = await watchSignIn(
      browser,
      (cookie) => {
        received.push(cookie);
        return Promise.resolve({ ok: true, username: 'demo_reader' });
      },
      { timeoutMs: 60_000, pollMs: 0 },
    );
    expect(visited).toEqual(['https://www.reddit.com/login/']);
    expect(received).toEqual(['loid=synthetic-loid; reddit_session=synthetic-session']);
    expect(outcome).toEqual({ status: 'connected', username: 'demo_reader' });
    expect(isOpen()).toBe(false);
  });

  it('gives up after the time limit and closes the window', async () => {
    const { browser, isOpen } = fakeBrowser({ polls: 1_000, cookies: [] });
    let clock = 0;
    const outcome = await watchSignIn(browser, () => Promise.reject(new Error('unused')), {
      timeoutMs: 3,
      pollMs: 0,
      now: () => (clock += 1),
    });
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(isOpen()).toBe(false);
  });

  it('reports a cookie Reddit then refuses', async () => {
    const { browser } = fakeBrowser({
      polls: 0,
      cookies: [{ name: 'reddit_session', value: 'synthetic-session' }],
    });
    const outcome = await watchSignIn(
      browser,
      () => Promise.resolve({ ok: false, message: 'Reddit did not accept this session.' }),
      { timeoutMs: 60_000, pollMs: 0 },
    );
    expect(outcome).toEqual({ status: 'failed', message: 'Reddit did not accept this session.' });
  });
});
