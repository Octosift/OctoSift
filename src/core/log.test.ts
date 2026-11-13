import { describe, expect, it } from 'vitest';
import { createLogger, type LogRecord } from './log';
import { createRedactor } from './secrets/redact';
import { FAKE_KEYS } from './testing/fake-secrets';

function capture(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
  const records: LogRecord[] = [];
  const redactor = createRedactor();
  const logger = createLogger({ level, redactor, sink: (record) => records.push(record) });
  return { records, redactor, logger };
}

describe('logger', () => {
  it('drops records below the configured level', () => {
    const { records, logger } = capture('warn');
    logger.info('hidden');
    logger.warn('shown');
    expect(records.map((record) => record.message)).toEqual(['shown']);
  });

  it('redacts stored secrets from messages and fields', () => {
    const { records, redactor, logger } = capture();
    redactor.remember('stored-secret-value');
    logger.error('call failed: stored-secret-value', { detail: 'key stored-secret-value' });
    expect(JSON.stringify(records)).not.toContain('stored-secret-value');
  });

  it('redacts key-shaped strings it was never told about', () => {
    const { records, logger } = capture();
    logger.warn(`provider said: invalid key ${FAKE_KEYS.anthropic}`);
    expect(JSON.stringify(records)).not.toContain(FAKE_KEYS.anthropic);
  });

  it('serialises errors to their message', () => {
    const { records, logger } = capture();
    logger.error('scan failed', { error: new Error('disk full') });
    expect(records[0]?.fields).toEqual({ error: { name: 'Error', message: 'disk full' } });
  });

  it('creates child loggers that add fixed fields', () => {
    const { records, logger } = capture();
    logger.child({ runId: 'r1' }).info('started', { posts: 3 });
    expect(records[0]?.fields).toEqual({ runId: 'r1', posts: 3 });
  });
});
