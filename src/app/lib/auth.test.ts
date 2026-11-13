import { describe, expect, it } from 'vitest';
import {
  createLoginThrottle,
  isValidSession,
  passwordMatches,
  safeNextPath,
  SESSION_MAX_AGE_S,
  sessionToken,
} from './auth';

const NOW = 1_800_000_000;

describe('password gate', () => {
  it('accepts a session token made from the password', () => {
    expect(isValidSession('open sesame', sessionToken('open sesame', NOW), NOW)).toBe(true);
  });

  it('rejects a missing, malformed or altered token, or one made from another password', () => {
    expect(isValidSession('open sesame', undefined, NOW)).toBe(false);
    expect(isValidSession('open sesame', 'garbage', NOW)).toBe(false);
    expect(isValidSession('open sesame', sessionToken('other', NOW), NOW)).toBe(false);
    const [, mac] = sessionToken('open sesame', NOW).split('.');
    expect(isValidSession('open sesame', `${String(NOW + 1)}.${mac ?? ''}`, NOW + 1)).toBe(false);
  });

  it('lets sessions expire and refuses tokens issued in the future', () => {
    const token = sessionToken('open sesame', NOW);
    expect(isValidSession('open sesame', token, NOW + SESSION_MAX_AGE_S)).toBe(true);
    expect(isValidSession('open sesame', token, NOW + SESSION_MAX_AGE_S + 1)).toBe(false);
    expect(isValidSession('open sesame', sessionToken('open sesame', NOW + 3600), NOW)).toBe(false);
  });

  it('compares passwords exactly', () => {
    expect(passwordMatches('open sesame', 'open sesame')).toBe(true);
    expect(passwordMatches('open sesame', 'open sesame ')).toBe(false);
  });

  it.each([
    ['/inbox?lead=1', '/inbox?lead=1'],
    ['https://elsewhere.example', '/'],
    ['//elsewhere.example', '/'],
    ['/\\elsewhere.example', '/'],
    ['/\t/elsewhere.example', '/'],
    ['/\n/elsewhere.example', '/'],
    ['/inbox\\..', '/'],
    [null, '/'],
  ])('only redirects to local paths (%j)', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe('login throttle', () => {
  it('pauses sign-ins after too many wrong passwords, then recovers', () => {
    const throttle = createLoginThrottle({ maxFailures: 3, windowMs: 60_000 });
    for (const at of [0, 10_000, 20_000]) {
      expect(throttle.blocked(at)).toBe(false);
      throttle.fail(at);
    }
    expect(throttle.blocked(30_000)).toBe(true);
    expect(throttle.blocked(60_001)).toBe(false);
  });
});
