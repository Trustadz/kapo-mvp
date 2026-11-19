'use client';

import { useEffect } from 'react';

/**
 * Registers the minimal service worker in production builds.
 *
 * The worker only precaches the app shell/static assets; authenticated API
 * responses are never cached (see public/sw.js).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* Installing the PWA is optional; a failed registration must not surface errors. */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
