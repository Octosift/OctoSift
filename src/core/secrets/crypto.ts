/**
 * Authenticated encryption for secrets stored in SQLite (AES-256-GCM).
 *
 * The master key comes from APP_SECRET when set (stretched to 32 bytes with
 * HKDF), otherwise from a random key file created on first run with mode
 * 0600. Losing the key makes stored secrets unreadable; the user then enters
 * them again.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_SALT = 'secret-store-salt-v1';
const HKDF_INFO = 'secret-store-key-v1';

export interface Sealed {
  /** base64 of ciphertext followed by the authentication tag */
  ciphertext: string;
  /** base64 of the 12-byte nonce */
  nonce: string;
}

export type DecryptResult = { ok: true; plaintext: string } | { ok: false };

export function encrypt(key: Buffer, plaintext: string): Sealed {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]).toString('base64'),
    nonce: nonce.toString('base64'),
  };
}

export function decrypt(key: Buffer, sealed: Sealed): DecryptResult {
  const bytes = Buffer.from(sealed.ciphertext, 'base64');
  if (bytes.length < TAG_BYTES) return { ok: false };
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64'));
  decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
  try {
    const plaintext = Buffer.concat([
      decipher.update(bytes.subarray(0, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
    return { ok: true, plaintext };
  } catch {
    // GCM authentication failed: wrong key or modified data. Callers treat
    // this as "secret unreadable" and ask the user to enter it again.
    return { ok: false };
  }
}

export interface MasterKeyOptions {
  appSecret?: string | undefined;
  keyFilePath: string;
}

export function loadMasterKey({ appSecret, keyFilePath }: MasterKeyOptions): Buffer {
  if (appSecret !== undefined && appSecret.length > 0) {
    return Buffer.from(hkdfSync('sha256', appSecret, HKDF_SALT, HKDF_INFO, KEY_BYTES));
  }
  if (existsSync(keyFilePath)) {
    const key = readFileSync(keyFilePath);
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `The key file at ${keyFilePath} must contain exactly ${KEY_BYTES} bytes. ` +
          'Restore the original file or set APP_SECRET.',
      );
    }
    return key;
  }
  const key = randomBytes(KEY_BYTES);
  mkdirSync(dirname(keyFilePath), { recursive: true });
  writeFileSync(keyFilePath, key, { mode: 0o600, flag: 'wx' });
  return key;
}
