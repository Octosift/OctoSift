import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Sensitive-looking values are assembled at runtime so this file itself
// stays clean under the leak check it is testing.
const SAMPLES = {
  privateKey: ['-----BEGIN ', 'RSA PRIVATE KEY', '-----'].join(''),
  openAiKey: 'sk' + '-proj-' + 'a1B2c3D4e5F6g7H8i9J0kLmN',
  anthropicKey: 'sk' + '-ant-' + 'api03-' + 'x'.repeat(30),
  awsKey: 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
  slackToken: 'xo' + 'xb-' + '1234567890-abcdef',
  githubToken: 'gh' + 'p_' + 'A'.repeat(36),
  bearer: 'Bear' + 'er ' + 'QWxhZGRpbjpvcGVuIHNlc2FtZQ' + '==abcdef',
  email: 'jane.doe' + '@' + 'mailhost.test',
  allowedEmail: 'dev' + '@' + 'octosift.invalid',
  homePath: ['', 'Us' + 'ers', 'someone', 'projects'].join('/'),
  linuxHomePath: ['', 'ho' + 'me', 'someone', 'projects'].join('/'),
};

const SCRIPT = resolve(import.meta.dirname, '../../scripts/leakcheck.sh');
const TMP_ROOT = resolve(import.meta.dirname, '../../.tmp');

let repo: string;

function git(...args: string[]) {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

function write(file: string, content: string) {
  writeFileSync(join(repo, file), content);
}

function runCheck(options: { all?: boolean; denylist?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LEAKCHECK_DENYLIST;
  if (options.denylist !== undefined) env.LEAKCHECK_DENYLIST = options.denylist;
  const result = spawnSync('bash', [SCRIPT, ...(options.all ? ['--all'] : [])], {
    cwd: repo,
    env,
    encoding: 'utf8',
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  mkdirSync(TMP_ROOT, { recursive: true });
  repo = mkdtempSync(join(TMP_ROOT, 'leakcheck-'));
  git('init', '-q');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('leakcheck', () => {
  it('passes when staged files contain nothing sensitive', () => {
    write('clean.ts', `export const contact = '${SAMPLES.allowedEmail}';\n`);
    git('add', '.');
    expect(runCheck().code).toBe(0);
  });

  it.each([
    ['a private key header', SAMPLES.privateKey],
    ['an OpenAI-style key', SAMPLES.openAiKey],
    ['an Anthropic-style key', SAMPLES.anthropicKey],
    ['an AWS access key id', SAMPLES.awsKey],
    ['a Slack token', SAMPLES.slackToken],
    ['a GitHub token', SAMPLES.githubToken],
    ['a long bearer token', SAMPLES.bearer],
    ['an e-mail address outside the allowed domains', SAMPLES.email],
    ['a macOS home directory path', SAMPLES.homePath],
    ['a Linux home directory path', SAMPLES.linuxHomePath],
  ])('fails on %s', (_label, sample) => {
    write('leak.txt', `before\nvalue: ${sample}\nafter\n`);
    git('add', '.');
    const result = runCheck();
    expect(result.code).toBe(1);
    expect(result.output).toContain('leak.txt:2');
  });

  it('does not treat words that merely contain "sk-" as keys', () => {
    write('flags.ts', "const name = 'risk-flags-for-the-sentiment-analysis-stage';\n");
    git('add', '.');
    expect(runCheck().code).toBe(0);
  });

  it('fails on any pattern from the denylist file without printing the pattern', () => {
    const denylist = join(repo, '..', `${repo.split('/').pop() ?? 'x'}.deny`);
    writeFileSync(denylist, '# private terms\n\nZorblatt Industries\n');
    write('notes.md', 'We compared it with zorblatt industries last week.\n');
    git('add', '.');
    const result = runCheck({ denylist });
    rmSync(denylist);
    expect(result.code).toBe(1);
    expect(result.output).toContain('notes.md:1');
    expect(result.output.toLowerCase()).not.toContain('zorblatt');
  });

  it('fails when the denylist variable points at a missing file', () => {
    write('clean.ts', 'export const value = 1;\n');
    git('add', '.');
    const result = runCheck({ denylist: join(repo, 'does-not-exist.txt') });
    expect(result.code).toBe(1);
    expect(result.output).toContain('denylist');
  });

  it('checks file names as well as file contents', () => {
    const denylist = join(repo, '..', `${repo.split('/').pop() ?? 'x'}.deny`);
    writeFileSync(denylist, 'zorblatt\n');
    write('zorblatt-notes.md', 'nothing here\n');
    git('add', '.');
    const result = runCheck({ denylist });
    rmSync(denylist);
    expect(result.code).toBe(1);
  });

  it('only looks at staged files by default', () => {
    write('staged.ts', 'export const value = 1;\n');
    git('add', 'staged.ts');
    write('unstaged.txt', `${SAMPLES.homePath}\n`);
    expect(runCheck().code).toBe(0);
  });

  it('checks the staged version of a file rather than the working copy', () => {
    write('config.ts', `export const path = '${SAMPLES.homePath}';\n`);
    git('add', 'config.ts');
    write('config.ts', 'export const path = "clean";\n');
    expect(runCheck().code).toBe(1);
  });

  it('scans tracked and untracked files with --all', () => {
    write('.gitignore', 'ignored.txt\n');
    write('ignored.txt', `${SAMPLES.homePath}\n`);
    write('untracked.txt', 'fine\n');
    expect(runCheck({ all: true }).code).toBe(0);
    write('untracked.txt', `${SAMPLES.email}\n`);
    expect(runCheck({ all: true }).code).toBe(1);
  });
});
