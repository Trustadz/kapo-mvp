import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/en';
import { nl } from '@/i18n/nl';
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES, parseLocale } from '@/i18n/config';
import { interpolate, plural, t } from '@/i18n/translate';
import { formatDate, formatNumber, formatRelative, formatTime } from '@/i18n/format';
import { validateUsername } from '@/lib/validation';

/**
 * Issue #21: cookie-based English/Dutch UI translation.
 *
 * The English catalog defines the shape; `nl.ts` is typed against it, so these
 * runtime checks are a second safety net for key and placeholder parity.
 */

type Tree = Record<string, unknown>;

function flatten(value: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') {
    out.set(prefix, value);
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value as Tree)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

const enMessages = flatten(en);
const nlMessages = flatten(nl);

describe('message catalog parity', () => {
  it('has the same message keys in English and Dutch', () => {
    expect([...nlMessages.keys()].sort()).toEqual([...enMessages.keys()].sort());
  });

  it('has no empty translations', () => {
    for (const [key, message] of [...enMessages, ...nlMessages]) {
      expect(message.trim(), key).not.toBe('');
    }
  });

  it('keeps the same interpolation placeholders in both locales', () => {
    for (const [key, english] of enMessages) {
      const dutch = nlMessages.get(key);
      expect(dutch, key).toBeDefined();
      expect(placeholders(dutch ?? ''), key).toEqual(placeholders(english));
    }
  });

  it('lists exactly the supported locales', () => {
    expect([...LOCALES]).toEqual(['en', 'nl']);
    expect(LOCALE_LABELS.nl).toBe('Nederlands');
    expect(DEFAULT_LOCALE).toBe('en');
  });
});

describe('translate', () => {
  it('returns the locale message and falls back to English', () => {
    expect(t('en', 'auth.signIn')).toBe('Sign in');
    expect(t('nl', 'auth.signIn')).toBe('Inloggen');
    // Unknown runtime keys fall back to English, then to the key itself.
    expect(t('nl', 'auth.signIn' as never)).toBe('Inloggen');
  });

  it('interpolates named variables', () => {
    expect(
      t('en', 'inbox.releaseSuccess', { title: 'Paint hallway', status: 'To do' }),
    ).toBe('Released “Paint hallway” to To do.');
    expect(
      t('nl', 'inbox.releaseSuccess', { title: 'Gang schilderen', status: 'Te doen' }),
    ).toBe('‘Gang schilderen’ vrijgegeven naar Te doen.');
    expect(interpolate('Hello {name}, {missing}', { name: 'Sam' })).toBe('Hello Sam, {missing}');
  });

  it('selects English and Dutch plural forms with Intl.PluralRules', () => {
    expect(plural('en', 'plurals.releases', 1)).toBe('Released 1 capture.');
    expect(plural('en', 'plurals.releases', 2)).toBe('Released 2 captures.');
    expect(plural('nl', 'plurals.releases', 1)).toBe('1 item vrijgegeven.');
    expect(plural('nl', 'plurals.releases', 2)).toBe('2 items vrijgegeven.');
    expect(plural('en', 'plurals.filterCount', 1, { matching: 1, total: 1 })).toBe(
      '1 of 1 project',
    );
    expect(plural('nl', 'plurals.filterCount', 2, { matching: 1, total: 2 })).toBe(
      '1 van 2 projecten',
    );
  });
});

describe('locale cookie parsing', () => {
  it('accepts supported locales and falls back to English', () => {
    expect(parseLocale('nl')).toBe('nl');
    expect(parseLocale('en')).toBe('en');
    expect(parseLocale('de')).toBe('en');
    expect(parseLocale('')).toBe('en');
    expect(parseLocale(null)).toBe('en');
    expect(parseLocale(undefined)).toBe('en');
  });
});

describe('locale-aware formatting', () => {
  const timestamp = '2026-11-17T12:00:00.000Z';

  it('formats dates and times per locale', () => {
    expect(formatDate('en', timestamp)).toBe('17 Nov 2026');
    expect(formatDate('nl', timestamp)).toBe('17 nov 2026');
    expect(formatTime('en', timestamp)).toMatch(/^\d{2}:\d{2}$/);
    // Both locales use the 24-hour clock and agree on the local time.
    expect(formatTime('nl', timestamp)).toBe(formatTime('en', timestamp));
  });

  it('formats numbers per locale', () => {
    expect(formatNumber('en', 1234.5)).toBe('1,234.5');
    expect(formatNumber('nl', 1234.5)).toBe('1.234,5');
  });

  it('formats relative time per locale', () => {
    const now = new Date('2026-11-20T12:00:00.000Z');
    expect(formatRelative('en', '2026-11-19T12:00:00.000Z', now)).toBe('yesterday');
    expect(formatRelative('nl', '2026-11-19T12:00:00.000Z', now)).toBe('gisteren');
  });
});

describe('localized validation messages', () => {
  it('uses the Dutch catalog when a locale is supplied', () => {
    expect(validateUsername('a', 'nl')).toBe(
      'De gebruikersnaam moet minimaal 3 tekens bevatten.',
    );
    expect(validateUsername('a')).toBe('Username must be at least 3 characters.');
  });
});
