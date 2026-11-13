import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, loadMasterKey } from './crypto';

const TMP_ROOT = resolve(import.meta.dirname, '../../../.tmp');
const dirs: string[] = [];

function tempDir() {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'crypto-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const keyA = Buffer.alloc(32, 1);
const keyB = Buffer.alloc(32, 2);

describe('encrypt and decrypt', () => {
  it('round-trips a value', () => {
    const sealed = encrypt(keyA, 'a secret value');
    expect(decrypt(keyA, sealed)).toEqual({ ok: true, plaintext: 'a secret value' });
  });

  it('uses a fresh nonce for every encryption', () => {
    const first = encrypt(keyA, 'same');
    const second = encrypt(keyA, 'same');
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('fails with the wrong key', () => {
    const sealed = encrypt(keyA, 'a secret value');
    expect(decrypt(keyB, sealed)).toEqual({ ok: false });
  });

  it('fails when the ciphertext was tampered with', () => {
    const sealed = encrypt(keyA, 'a secret value');
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    expect(decrypt(keyA, { ...sealed, ciphertext: bytes.toString('base64') })).toEqual({
      ok: false,
    });
  });
});

describe('loadMasterKey', () => {
  it('derives the same 32-byte key from the same APP_SECRET', () => {
    const dir = tempDir();
    const first = loadMasterKey({
      appSecret: 'correct horse battery',
      keyFilePath: join(dir, 'k'),
    });
    const second = loadMasterKey({
      appSecret: 'correct horse battery',
      keyFilePath: join(dir, 'k'),
    });
    expect(first).toHaveLength(32);
    expect(first.equals(second)).toBe(true);
  });

  it('derives different keys from different secrets', () => {
    const dir = tempDir();
    const first = loadMasterKey({ appSecret: 'one secret value', keyFilePath: join(dir, 'k') });
    const second = loadMasterKey({
      appSecret: 'another secret value',
      keyFilePath: join(dir, 'k'),
    });
    expect(first.equals(second)).toBe(false);
  });

  it('creates a private key file on first run and reuses it afterwards', () => {
    const dir = tempDir();
    const keyFilePath = join(dir, 'data', '.secret');
    const first = loadMasterKey({ keyFilePath });
    const second = loadMasterKey({ keyFilePath });
    expect(first.equals(second)).toBe(true);
    expect(readFileSync(keyFilePath)).toHaveLength(32);
    expect(statSync(keyFilePath).mode & 0o777).toBe(0o600);
  });

  it('refuses a key file of the wrong size', () => {
    const dir = tempDir();
    const keyFilePath = join(dir, '.secret');
    writeFileSync(keyFilePath, 'short');
    expect(() => loadMasterKey({ keyFilePath })).toThrow(/32 bytes/);
  });
});
