import { describe, expect, it } from 'vitest';
import { isPublicAddress, privateHostReason, type ResolveHost } from './address';

const resolvesTo =
  (...addresses: string[]): ResolveHost =>
  () =>
    Promise.resolve(addresses);

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    'not-an-address',
  ])('rejects %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['203.0.113.10', '198.51.100.7', '172.32.0.1', '2001:db8::1'])(
    'accepts %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe('privateHostReason', () => {
  it('accepts a host whose addresses are all public', async () => {
    const url = new URL('https://acme-invoices.example/');
    expect(await privateHostReason(url, resolvesTo('203.0.113.10'))).toBeNull();
  });

  it('rejects a host when any of its addresses is private', async () => {
    const url = new URL('https://acme-invoices.example/');
    expect(await privateHostReason(url, resolvesTo('203.0.113.10', '10.0.0.5'))).toMatch(
      /private network/,
    );
  });

  it('checks IP literals without resolving them, whatever notation the URL used', async () => {
    const unused: ResolveHost = () => Promise.reject(new Error('should not resolve'));
    for (const raw of [
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      expect(await privateHostReason(new URL(raw), unused), raw).toMatch(/private network/);
    }
    expect(await privateHostReason(new URL('http://203.0.113.10/'), unused)).toBeNull();
  });

  it('reports a host that cannot be resolved', async () => {
    const failing: ResolveHost = () => Promise.reject(new Error('ENOTFOUND'));
    const url = new URL('https://missing.example/');
    expect(await privateHostReason(url, failing)).toBe('the address could not be found');
    expect(await privateHostReason(url, resolvesTo())).toBe('the address could not be found');
  });
});
