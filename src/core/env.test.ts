import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('fills in defaults', () => {
    expect(parseEnv({})).toEqual({
      ok: true,
      env: {
        DATABASE_PATH: 'data/app.sqlite',
        LOG_LEVEL: 'info',
        PUBLIC_URL: 'http://127.0.0.1:3005',
        DEMO_MODE: false,
        EXPERIMENTAL_CLI_PROVIDERS: false,
        UPDATE_CHECK: true,
      },
    });
  });

  it('keeps the update check on unless it is turned off explicitly', () => {
    const check = (value?: string) => {
      const result = parseEnv(value === undefined ? {} : { UPDATE_CHECK: value });
      return result.ok ? result.env.UPDATE_CHECK : 'invalid';
    };
    expect(check()).toBe(true);
    expect(check('')).toBe(true);
    expect(check('1')).toBe(true);
    expect(check('0')).toBe(false);
    expect(check('false')).toBe(false);
    expect(check('no')).toBe(false);
    expect(check('maybe')).toBe('invalid');
  });

  it('treats empty values as unset and reads flags', () => {
    const result = parseEnv({ APP_SECRET: '', DEMO_MODE: '1', LOG_LEVEL: 'debug' });
    expect(result).toMatchObject({ ok: true, env: { DEMO_MODE: true, LOG_LEVEL: 'debug' } });
    expect(result.ok && result.env.APP_SECRET).toBeUndefined();
  });

  it('reports invalid values', () => {
    const result = parseEnv({ LOG_LEVEL: 'loud' });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.errors.join(' ')).toContain('LOG_LEVEL');
  });
});
