import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Chrome fetches the web app manifest through the service worker when it checks
 * an installed PWA for updates. Serving it from Cache Storage freezes the
 * installed app's theme colour and metadata, so it must stay network-only.
 */
describe('service worker', () => {
  it('never precaches or intercepts the web app manifest', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../public/sw.js', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/manifest\.webmanifest/);
  });
});
