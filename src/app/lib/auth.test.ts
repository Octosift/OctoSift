import { describe, expect, it } from 'vitest';
import { isValidSession, passwordMatches, safeNextPath, sessionToken } from './auth';

describe('password gate', () => {
  it('accepts the session token derived from the password', () => {
    expect(isValidSession('open sesame', sessionToken('open sesame'))).toBe(true);
  });

  it('rejects a missing token or one made from another password', () => {
    expect(isValidSession('open sesame', undefined)).toBe(false);
    expect(isValidSession('open sesame', sessionToken('other'))).toBe(false);
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
    [null, '/'],
  ])('only redirects to local paths (%s)', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
