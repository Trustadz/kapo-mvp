/** Small class-name join helper (no runtime dependencies). */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
