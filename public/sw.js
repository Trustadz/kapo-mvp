/*
 * Kapo minimal service worker.
 *
 * Scope: installability plus a static-asset cache. Authenticated pages and all
 * /api/* responses are never cached — the server stays authoritative and no
 * private project data is written to Cache Storage.
 */

const VERSION = 'kapo-v1';
const CACHE_NAME = `${VERSION}-static`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [
  OFFLINE_URL,
  '/logo.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/logo.svg' ||
    url.pathname === '/manifest.webmanifest'
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache or serve authenticated JSON.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/healthz')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (!isStaticAsset(url)) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
