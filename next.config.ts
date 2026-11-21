import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Lets parallel agents run isolated dev/build outputs against the same checkout.
  distDir: process.env.NEXT_DIST_DIR?.trim() || '.next',
  output: 'standalone',
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  // Local development may be opened through either host name, plus any extra
  // origins you list in KAPO_DEV_ORIGINS (comma-separated, e.g. the VM's LAN IP).
  // A non-allowed origin breaks the HMR websocket and the page never hydrates.
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
    ...(process.env.KAPO_DEV_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ],
  // Never ship the runtime database/uploads or test/docs folders in the
  // standalone output that is copied into the Docker image.
  outputFileTracingExcludes: {
    '*': ['./data/**', './tests/**', './docs/**', './playwright-report/**'],
  },
};

export default nextConfig;
