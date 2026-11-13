import { describe, expect, it } from 'vitest';
import { FAKE_KEYS } from '../testing/fake-secrets';
import { createRedactor } from './redact';

describe('redactor', () => {
  it.each(Object.entries(FAKE_KEYS))('removes a %s-shaped key from text', (_name, value) => {
    const redactor = createRedactor();
    const output = redactor.redact(`request failed with key ${value} at step 2`);
    expect(output).not.toContain(value);
    expect(output).toContain('[redacted]');
    expect(output).toContain('at step 2');
  });

  it('removes bearer tokens and credentials embedded in URLs', () => {
    const redactor = createRedactor();
    const bearer = 'Bear' + 'er ' + 'abcdefghijklmnopqrstuvwxyz012345';
    const url = 'https://login:' + 'hunter2hunter2' + '@api.example.com/v3';
    const output = redactor.redact(`${bearer} ${url}`);
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
    expect(output).not.toContain('hunter2hunter2');
  });

  it('removes values it has been told about, even when they look ordinary', () => {
    const redactor = createRedactor();
    redactor.remember('correct-horse-battery');
    expect(redactor.redact('password correct-horse-battery rejected')).toBe(
      'password [redacted] rejected',
    );
  });

  it('ignores remembered values too short to redact safely', () => {
    const redactor = createRedactor();
    redactor.remember('ab');
    expect(redactor.redact('about a cab')).toBe('about a cab');
  });

  it('leaves ordinary text alone', () => {
    const redactor = createRedactor();
    const text = 'Scanned 4 subreddits, 12 posts, risk-flags ok, task-queue empty.';
    expect(redactor.redact(text)).toBe(text);
  });

  it('redacts strings nested in objects, arrays and errors', () => {
    const redactor = createRedactor();
    redactor.remember('nested-secret-value');
    const output = redactor.redactValue({
      list: ['fine', 'has nested-secret-value inside'],
      error: new Error(`bad key ${FAKE_KEYS.openAi}`),
      count: 3,
    });
    const text = JSON.stringify(output);
    expect(text).not.toContain('nested-secret-value');
    expect(text).not.toContain(FAKE_KEYS.openAi);
    expect(text).toContain('"count":3');
  });
});
