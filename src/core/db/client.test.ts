import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATIONS_FOLDER, openDatabase, openMemoryDatabase } from './client';
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

/** A database migrated up to, but not including, the migration with this tag. */
function databaseBefore(tag: string) {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'migrations-'));
  cleanup.push(dir);
  cpSync(DEFAULT_MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  journal.entries = journal.entries.slice(0, index);
  writeFileSync(journalPath, JSON.stringify(journal));
  return openMemoryDatabase(dir);
}

function columns(db: ReturnType<typeof openMemoryDatabase>, table: string): string[] {
  return db.$client
    .prepare(`select name from pragma_table_info('${table}')`)
    .all()
    .map((row) => (row as { name: string }).name);
}

describe('removing the paid data source', () => {
  it('keeps AI costs and settings, and drops what only that source used', () => {
    const db = databaseBefore('0007_drop_data_provider');
    const sql = db.$client;
    const run = sql.prepare(
      "insert into runs (id, started_at, trigger, status, counts_json, cost_usd, data_cost_usd) values (?, 1, 'schedule', 'ok', '{}', ?, ?)",
    );
    run.run('r1', 0.05, 0.02);
    run.run('r2', 0.01, 0);
    const use = sql.prepare(
      'insert into usage (id, run_id, stage, provider, model, input_tokens, output_tokens, cost_usd, created_at) values (?, ?, ?, ?, ?, 0, 0, ?, 1)',
    );
    use.run('u1', 'r1', 'triage', 'openai', 'demo-triage', 0.03);
    use.run('u2', 'r1', 'reddit_data', 'paid', 'paid/feed', 0.02);
    const setting = sql.prepare('insert into settings (key, value_json) values (?, ?)');
    setting.run('reddit.source', '"provider"');
    setting.run('reddit.provider', '"adapter"');
    setting.run('reddit.providerPriceUsd', '0.001');
    setting.run('reddit.failover', 'true');
    setting.run(
      'state.sourceFailover',
      JSON.stringify({ from: 'session', to: 'provider', reason: 'x', at: 1 }),
    );
    const secret = sql.prepare(
      "insert into secrets (name, ciphertext, nonce, created_at) values (?, 'c', 'n', 1)",
    );
    secret.run('openai_api_key');
    secret.run('paid_source_key');

    migrate(drizzle(sql), { migrationsFolder: DEFAULT_MIGRATIONS_FOLDER });

    const costs = sql.prepare('select id, cost_usd as cost from runs order by id').all() as {
      id: string;
      cost: number;
    }[];
    expect(costs.map((row) => [row.id, Number(row.cost.toFixed(6))])).toEqual([
      ['r1', 0.03],
      ['r2', 0.01],
    ]);
    expect(sql.prepare('select stage from usage').all()).toEqual([{ stage: 'triage' }]);
    expect(sql.prepare('select key, value_json as value from settings order by key').all()).toEqual(
      [
        { key: 'reddit.failover', value: 'true' },
        { key: 'reddit.source', value: '"session"' },
      ],
    );
    expect(sql.prepare('select name from secrets').all()).toEqual([{ name: 'openai_api_key' }]);
    expect(columns(db, 'runs')).not.toContain('data_cost_usd');
    expect(columns(db, 'posts')).not.toContain('partial');
  });
});
