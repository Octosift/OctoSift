import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  it('fills in defaults', () => {
    expect(parseEnv({})).toEqual({
      ok: true,
      env: {
        DATABASE_PATH: 'data/app.sqlite',
        LOG_LEVEL: 'info',
        PUBLIC_URL: 'http://127.0.0.1:3000',
        DEMO_MODE: false,
      },
    });
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
