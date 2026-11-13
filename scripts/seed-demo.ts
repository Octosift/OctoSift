/**
 * Creates the demo database from scratch: the Acme Invoices sample product
 * with a few days of scan history. Only ever touches the demo database file.
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '../src/core/db/client';
import { seedDemo } from '../src/core/demo/seed';
import { parseEnv } from '../src/core/env';

const parsed = parseEnv(process.env);
if (!parsed.ok) {
  process.stderr.write(`Invalid environment:\n${parsed.errors.join('\n')}\n`);
  process.exit(2);
}
const path = resolve(process.cwd(), parsed.env.DATABASE_PATH);
if (!path.endsWith('demo.sqlite')) {
  process.stderr.write('Refusing to seed a database that is not named demo.sqlite.\n');
  process.exit(2);
}
for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });

const db = openDatabase({ path });
const summary = await seedDemo(db, Date.now());
db.$client.close();
process.stdout.write(`Demo data ready: ${summary.leads} leads from ${summary.runs} scans.\n`);
