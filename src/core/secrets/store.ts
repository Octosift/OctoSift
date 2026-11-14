/**
 * Encrypted storage for API keys and other credentials.
 *
 * Contract: a secret goes in through `set` and comes back in plaintext only
 * through `use`, which is meant for the code that makes the outbound call.
 * Everything shown to the user goes through `describe`, which returns a mask.
 * Environment variables take precedence over stored values so deployments can
 * keep keys out of the database entirely.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { secrets } from '../db/schema';
import { decrypt, encrypt } from './crypto';
import type { Redactor } from './redact';

/** Every secret the app knows about, with the environment variable that overrides it. */
export const SECRET_ENV_VARS = {
  openai_api_key: 'OPENAI_API_KEY',
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  google_api_key: 'GOOGLE_GENERATIVE_AI_API_KEY',
  openai_compatible_api_key: 'OPENAI_COMPATIBLE_API_KEY',
  reddit_session_cookie: 'REDDIT_SESSION_COOKIE',
  dataforseo_login: 'DATAFORSEO_LOGIN',
  dataforseo_password: 'DATAFORSEO_PASSWORD',
  webhook_url: 'WEBHOOK_URL',
  reddit_proxy_url: 'REDDIT_PROXY_URL',
} as const;

export type SecretName = keyof typeof SECRET_ENV_VARS;
export const SECRET_NAMES = Object.keys(SECRET_ENV_VARS) as SecretName[];

export function isSecretName(value: string): value is SecretName {
  return Object.hasOwn(SECRET_ENV_VARS, value);
}

export type UseSecretResult =
  { ok: true; value: string } | { ok: false; kind: 'missing' | 'unreadable' };

export interface SecretDescription {
  configured: boolean;
  source: 'environment' | 'database' | 'none';
  mask: string | null;
}

export interface SecretStore {
  set(name: SecretName, value: string): void;
  has(name: SecretName): boolean;
  use(name: SecretName): UseSecretResult;
  describe(name: SecretName): SecretDescription;
  remove(name: SecretName): void;
  /** Registers every stored and environment secret with the redactor. */
  loadIntoRedactor(): void;
}

export interface SecretStoreOptions {
  db: Db;
  key: Buffer;
  env: Readonly<Record<string, string | undefined>>;
  redactor: Redactor;
  now: () => number;
}

/**
 * Shows enough to recognise a key ("sk-…a1b2") without revealing it. Short
 * values show nothing but the ellipsis, since four characters would be most
 * of the secret.
 */
export function maskSecret(value: string): string {
  if (value.length < 12) return '…';
  const prefixMatch = /^[A-Za-z]{2,4}[-_]/.exec(value);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  return `${prefix}…${value.slice(-4)}`;
}

export function createSecretStore({
  db,
  key,
  env,
  redactor,
  now,
}: SecretStoreOptions): SecretStore {
  function fromEnv(name: SecretName): string | undefined {
    const value = env[SECRET_ENV_VARS[name]];
    return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
  }

  function readStored(name: SecretName): UseSecretResult {
    const row = db.select().from(secrets).where(eq(secrets.name, name)).get();
    if (!row) return { ok: false, kind: 'missing' };
    const result = decrypt(key, { ciphertext: row.ciphertext, nonce: row.nonce });
    if (!result.ok) return { ok: false, kind: 'unreadable' };
    redactor.remember(result.plaintext);
    return { ok: true, value: result.plaintext };
  }

  function use(name: SecretName): UseSecretResult {
    const envValue = fromEnv(name);
    if (envValue !== undefined) {
      redactor.remember(envValue);
      return { ok: true, value: envValue };
    }
    return readStored(name);
  }

  return {
    set(name, value) {
      const trimmed = value.trim();
      const sealed = encrypt(key, trimmed);
      redactor.remember(trimmed);
      db.insert(secrets)
        .values({ name, ciphertext: sealed.ciphertext, nonce: sealed.nonce, createdAt: now() })
        .onConflictDoUpdate({
          target: secrets.name,
          set: { ciphertext: sealed.ciphertext, nonce: sealed.nonce, createdAt: now() },
        })
        .run();
    },

    has(name) {
      return use(name).ok;
    },

    use,

    describe(name) {
      const envValue = fromEnv(name);
      if (envValue !== undefined) {
        return { configured: true, source: 'environment', mask: maskSecret(envValue) };
      }
      const stored = readStored(name);
      if (stored.ok)
        return { configured: true, source: 'database', mask: maskSecret(stored.value) };
      return { configured: false, source: 'none', mask: null };
    },

    remove(name) {
      db.delete(secrets).where(eq(secrets.name, name)).run();
    },

    loadIntoRedactor() {
      for (const name of SECRET_NAMES) use(name);
    },
  };
}
