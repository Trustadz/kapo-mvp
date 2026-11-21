import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/inter';
import 'material-symbols/outlined.css';
import './globals.css';
import { ThemeScript } from '@/components/shell/ThemeScript';
import { I18nProvider } from '@/i18n/client';
import { getI18n, getLocale } from '@/i18n/server';
import { getSessionUser } from '@/server/auth/current-user';

/**
 * Root layout: self-hosted fonts, design tokens, PWA metadata and the
 * pre-paint theme script. Every route is dynamic because the shell depends on
 * the signed-in user.
 */

export const dynamic = 'force-dynamic';

function publicBaseUrl(): URL {
  try {
    return new URL(process.env.KAPO_PUBLIC_URL ?? 'http://localhost:3000');
  } catch {
    return new URL('http://localhost:3000');
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
  metadataBase: publicBaseUrl(),
  title: {
    default: 'Kapo',
    template: '%s · Kapo',
  },
  description: t('common.appDescription'),
  applicationName: 'Kapo',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Kapo',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    // Match the top bar and bottom navigation (surface), not the page canvas.
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#242A25' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  let appearance: 'light' | 'dark' | 'system' | null = null;
  try {
    const user = await getSessionUser();
    appearance = user?.appearance ?? null;
  } catch {
    // The database may not be reachable during a cold build; render anonymously.
    appearance = null;
  }

  const explicitTheme = appearance === 'light' || appearance === 'dark' ? appearance : undefined;

  return (
    <html lang={locale} data-theme={explicitTheme} suppressHydrationWarning>
      <body>
        <ThemeScript appearance={appearance} />
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
