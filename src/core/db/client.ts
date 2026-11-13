/**
 * Opens the SQLite database and brings its schema up to date.
 *
 * The worker and the dashboard are separate processes sharing one file, so
 * file databases use WAL mode and a busy timeout. Tests use an in-memory
 * database with the same migrations.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/**
 * Resolved from the working directory rather than this file, because bundlers
 * (the Next.js server build) move compiled modules away from their sources.
 */
export const DEFAULT_MIGRATIONS_FOLDER = resolve(process.cwd(), 'src/core/db/migrations');

export interface OpenDatabaseOptions {
  path: string;
  migrationsFolder?: string;
}

function configure(sqlite: Database.Database, migrationsFolder: string): Db {
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

export function openDatabase({
  path,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
}: OpenDatabaseOptions): Db {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  return configure(sqlite, migrationsFolder);
}

export function openMemoryDatabase(migrationsFolder = DEFAULT_MIGRATIONS_FOLDER): Db {
  return configure(new Database(':memory:'), migrationsFolder);
}
