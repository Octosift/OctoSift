import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { secrets } from '../db/schema';
import { FAKE_KEYS } from '../testing/fake-secrets';
import { createRedactor } from './redact';
import { createSecretStore, maskSecret } from './store';

const key = Buffer.alloc(32, 7);

function setup(env: Record<string, string | undefined> = {}) {
  const db = openMemoryDatabase();
  const redactor = createRedactor();
  const store = createSecretStore({ db, key, env, redactor, now: () => 1_700_000_000 });
  return { db, redactor, store };
}

describe('secret store', () => {
  it('returns a saved secret for internal use', () => {
    const { store } = setup();
    store.set('openai_api_key', FAKE_KEYS.openAi);
    expect(store.use('openai_api_key')).toEqual({ ok: true, value: FAKE_KEYS.openAi });
  });

  it('never writes the plaintext to the database', () => {
    const { db, store } = setup();
    store.set('openai_api_key', FAKE_KEYS.openAi);
    const rows = db.select().from(secrets).all();
    expect(JSON.stringify(rows)).not.toContain(FAKE_KEYS.openAi);
    expect(JSON.stringify(rows)).not.toContain(FAKE_KEYS.openAi.slice(8, 20));
  });

  it('reports whether a secret is configured', () => {
    const { store } = setup();
    expect(store.has('anthropic_api_key')).toBe(false);
    store.set('anthropic_api_key', FAKE_KEYS.anthropic);
    expect(store.has('anthropic_api_key')).toBe(true);
  });

  it('describes a saved secret with a mask only', () => {
    const { store } = setup();
    store.set('openai_api_key', FAKE_KEYS.openAi);
    const described = store.describe('openai_api_key');
    expect(described).toEqual({
      configured: true,
      source: 'database',
      mask: maskSecret(FAKE_KEYS.openAi),
    });
    expect(JSON.stringify(described)).not.toContain(FAKE_KEYS.openAi);
  });

  it('prefers an environment variable over a saved value', () => {
    const { store } = setup({ OPENAI_API_KEY: FAKE_KEYS.anthropic });
    store.set('openai_api_key', FAKE_KEYS.openAi);
    expect(store.use('openai_api_key')).toEqual({ ok: true, value: FAKE_KEYS.anthropic });
    expect(store.describe('openai_api_key').source).toBe('environment');
  });

  it('ignores empty environment variables', () => {
    const { store } = setup({ OPENAI_API_KEY: '' });
    expect(store.has('openai_api_key')).toBe(false);
  });

  it('removes a secret', () => {
    const { store } = setup();
    store.set('webhook_url', 'https://hooks.example.com/abc123def456');
    store.remove('webhook_url');
    expect(store.use('webhook_url')).toEqual({ ok: false, kind: 'missing' });
  });

  it('reports an unreadable secret when the encryption key changed', () => {
    const { db, store } = setup();
    store.set('openai_api_key', FAKE_KEYS.openAi);
    const other = createSecretStore({
      db,
      key: Buffer.alloc(32, 9),
      env: {},
      redactor: createRedactor(),
      now: () => 0,
    });
    expect(other.use('openai_api_key')).toEqual({ ok: false, kind: 'unreadable' });
  });

  it('teaches the redactor every secret it saves or loads', () => {
    const { redactor, store } = setup();
    store.set('dataforseo_password', 'plain-password-value');
    expect(redactor.redact('login failed for plain-password-value')).toBe(
      'login failed for [redacted]',
    );
  });

  it('teaches the redactor secrets already in the database when loaded', () => {
    const { db, store } = setup();
    store.set('dataforseo_password', 'plain-password-value');
    const redactor = createRedactor();
    const reopened = createSecretStore({ db, key, env: {}, redactor, now: () => 0 });
    reopened.loadIntoRedactor();
    expect(redactor.redact('plain-password-value')).toBe('[redacted]');
  });
});

describe('maskSecret', () => {
  it.each(
    Object.values(FAKE_KEYS).concat(['abc', 'abcdefgh', 'https://hooks.example.com/T0/B1/xyz']),
  )('never contains the secret itself (%#)', (value) => {
    const mask = maskSecret(value);
    expect(mask).not.toContain(value);
    expect(mask.replace('…', '').length).toBeLessThanOrEqual(Math.max(4, value.length - 4));
  });

  it('keeps a short prefix and the last four characters of long keys', () => {
    expect(maskSecret(FAKE_KEYS.openAi)).toBe(`sk-…${FAKE_KEYS.openAi.slice(-4)}`);
  });
});
