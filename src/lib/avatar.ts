/**
 * Avatar helpers shared by the shell, activity rows and user lists.
 *
 * The Penpot design assigns fixed colour pairs to the four seed accounts.
 * Arbitrary accounts are mapped deterministically onto the same four pairs so
 * the palette never grows beyond the design system.
 */

export const AVATAR_PALETTE_SIZE = 4;

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The design ships fixed avatar colour pairs for its four named actors; keep
 * those exact so seeded screens match the reference. Other accounts hash onto
 * the same four pairs.
 */
const DESIGN_ACTOR_PALETTES: Record<string, number> = {
  tristan: 1,
  maya: 2,
  jules: 3,
  alex: 4,
};

/** 1-based palette index used as the `data-palette` attribute. */
export function avatarPalette(name: string): number {
  const normalized = name.trim().toLowerCase();
  const designPalette = DESIGN_ACTOR_PALETTES[normalized];
  if (designPalette) return designPalette;
  return (hash(normalized) % AVATAR_PALETTE_SIZE) + 1;
}

/** Initials used until a profile picture is uploaded (max two characters). */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  if (parts.length === 1) return first.toUpperCase();
  const second = parts[parts.length - 1]?.[0] ?? '';
  return (first + second).toUpperCase();
}
