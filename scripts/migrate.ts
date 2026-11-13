/**
 * Applies pending database migrations. Run once before the dashboard and the
 * worker start, so the two processes never race to migrate the same file.
 */
import { resolve } from 'node:path';
import { openDatabase } from '../src/core/db/client';
import { parseEnv } from '../src/core/env';

const parsed = parseEnv(process.env);
if (!parsed.ok) {
  process.stderr.write(`Invalid environment:\n${parsed.errors.join('\n')}\n`);
  process.exit(2);
}
openDatabase({ path: resolve(process.cwd(), parsed.env.DATABASE_PATH) }).$client.close();
process.stdout.write('Database is up to date.\n');
