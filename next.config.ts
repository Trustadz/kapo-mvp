import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Lets parallel agents run isolated dev/build outputs against the same checkout.
  distDir: process.env.NEXT_DIST_DIR?.trim() || '.next',
  output: 'standalone',
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
  // Local development may be opened through either host name.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Never ship the runtime database/uploads or test/docs folders in the
  // standalone output that is copied into the Docker image.
  outputFileTracingExcludes: {
    '*': ['./data/**', './tests/**', './docs/**', './playwright-report/**'],
  },
};

export default nextConfig;
