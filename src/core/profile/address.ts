/**
 * Keeps the site crawler on the public internet.
 *
 * The crawler fetches whatever address the user types, and follows that
 * site's redirects. Without this check a hosted dashboard could be pointed at
 * its own machine, the local network or a cloud metadata service, and would
 * show the response as page text.
 */
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type ResolveHost = (hostname: string) => Promise<string[]>;

const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata services
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  // IPv4-mapped addresses (::ffff:a.b.c.d) need no rule: BlockList checks them
  // against the IPv4 ranges above.
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6');
}

/** True for an IP address that is reachable on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export const resolveWithDns: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, order: 'verbatim' })).map((entry) => entry.address);

/**
 * Returns why a URL's host must not be fetched, or null when every address it
 * resolves to is public.
 */
export async function privateHostReason(url: URL, resolve: ResolveHost): Promise<string | null> {
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
  let addresses: string[];
  try {
    addresses = isIP(hostname) === 0 ? await resolve(hostname) : [hostname];
  } catch {
    // An unknown host is reported like any other unreachable site.
    return 'the address could not be found';
  }
  if (addresses.length === 0) return 'the address could not be found';
  return addresses.every(isPublicAddress)
    ? null
    : 'the address points to this machine or a private network';
}
