import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // Native module; loaded by Node at runtime instead of being bundled.
  serverExternalPackages: ['better-sqlite3', 'playwright'],
  devIndicators: false,
  // Keep Next.js inside the project: no lockfile search in parent folders,
  // and no generated agent instruction files.
  turbopack: { root: import.meta.dirname },
  agentRules: false,
};

export default config;
