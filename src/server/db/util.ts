import { randomUUID } from 'node:crypto';

/** Server-side identifier and clock helpers (all timestamps are UTC ISO-8601). */

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Adds whole days to an ISO timestamp (used for the 30-day trash deadline). */
export function addDaysIso(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
