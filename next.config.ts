import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  // Native module; loaded by Node at runtime instead of being bundled.
  serverExternalPackages: ['better-sqlite3'],
  devIndicators: false,
};

export default config;
