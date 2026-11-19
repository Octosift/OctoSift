import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

describe('BRAND', () => {
  it('has the version from package.json, so update checks compare the right number', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(BRAND.version).toBe(pkg.version);
  });
});
