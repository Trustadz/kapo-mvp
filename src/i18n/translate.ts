import { DEFAULT_LOCALE, type Locale } from './config';
import { en } from './en';
import { nl } from './nl';
import type { MessageKey, Messages, PluralKey } from './catalog';

/** Catalog lookup table. Both catalogs are plain client-safe modules. */
export const CATALOGS: Record<Locale, Messages> = { en, nl };

export type Vars = Record<string, string | number | null | undefined>;

/**
 * Replaces `{name}` placeholders in a message. Unknown placeholders are kept
 * verbatim so a missing variable is visible during development instead of
 * silently disappearing. Null/undefined values render as an empty string.
 */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!(name in vars)) return match;
    const value = vars[name];
    return value === null || value === undefined ? '' : String(value);
  });
}

function lookup(catalog: Messages, key: string): string | undefined {
  let current: unknown = catalog;
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Translates `key` for `locale`, interpolating `{name}` placeholders.
 *
 * Unknown keys fall back to English and finally to the key itself, so a stale
 * key is visible rather than empty.
 */
export function t(locale: Locale, key: MessageKey, vars?: Vars): string {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  const value = lookup(catalog, key) ?? lookup(CATALOGS[DEFAULT_LOCALE], key) ?? key;
  return interpolate(value, vars);
}

/**
 * Picks the correct plural form with `Intl.PluralRules` (English and Dutch
 * both use one/other) and interpolates `count` automatically.
 */
export function plural(locale: Locale, key: PluralKey, count: number, vars?: Vars): string {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  const forms = key
    .split('.')
    .reduce<unknown>((current, part) => {
      if (typeof current !== 'object' || current === null) return undefined;
      return (current as Record<string, unknown>)[part];
    }, catalog);
  if (typeof forms !== 'object' || forms === null) {
    return key;
  }
  const rules = new Intl.PluralRules(locale);
  const category = rules.select(count);
  const record = forms as Record<string, string | undefined>;
  const template = record[category] ?? record.other ?? record.one ?? key;
  return interpolate(template, { ...vars, count });
}
