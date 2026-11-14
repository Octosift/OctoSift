import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, openMemoryDatabase } from './client';
import { evaluations, products } from './schema';

const TMP_ROOT = resolve(import.meta.dirname, '../../../.tmp');
const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tableNames(db: ReturnType<typeof openMemoryDatabase>) {
  return db.$client
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\' and name != 'sqlite_sequence'",
    )
    .all()
    .map((row) => (row as { name: string }).name)
    .sort();
}

describe('openMemoryDatabase', () => {
  it('creates every table from the migrations', () => {
    const db = openMemoryDatabase();
    expect(tableNames(db)).toEqual([
      'drafts',
      'evaluations',
      'feedback',
      'image_descriptions',
      'leads',
      'posts',
      'product_subreddits',
      'products',
      'reply_checks',
      'runs',
      'secrets',
      'serp_runs',
      'serp_threads',
      'settings',
      'subreddits',
      'usage',
    ]);
  });

  it('enforces foreign keys', () => {
    const db = openMemoryDatabase();
    expect(() =>
      db
        .insert(evaluations)
        .values({
          productId: 'missing',
          postId: 'missing',
          stage: 'triage',
          verdict: 'pass',
          reason: 'test',
          createdAt: 0,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('round-trips JSON columns', () => {
    const db = openMemoryDatabase();
    db.insert(products)
      .values({
        id: 'p1',
        name: 'Acme Invoices',
        url: 'https://acme-invoices.example',
        profileJson: { one_liner: 'Invoices for freelancers' },
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const row = db.select().from(products).get();
    expect(row?.profileJson).toEqual({ one_liner: 'Invoices for freelancers' });
    expect(row?.mode).toBe('direct');
  });
});

describe('openDatabase', () => {
  it('creates the parent folder and opens the file in WAL mode', () => {
    mkdirSync(TMP_ROOT, { recursive: true });
    const dir = mkdtempSync(join(TMP_ROOT, 'db-'));
    cleanup.push(dir);
    const db = openDatabase({ path: join(dir, 'nested', 'app.sqlite') });
    const mode = db.$client.pragma('journal_mode', { simple: true });
    db.$client.close();
    expect(mode).toBe('wal');
  });

  it('can be opened twice without re-running migrations', () => {
    mkdirSync(TMP_ROOT, { recursive: true });
    const dir = mkdtempSync(join(TMP_ROOT, 'db-'));
    cleanup.push(dir);
    const path = join(dir, 'app.sqlite');
    openDatabase({ path }).$client.close();
    const db = openDatabase({ path });
    expect(tableNames(db)).toContain('leads');
    db.$client.close();
  });
});
