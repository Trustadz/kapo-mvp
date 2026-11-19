'use client';

import type { ReactNode } from 'react';

export interface IconProps {
  /** Material Symbols ligature name, e.g. "home". */
  name: string;
  /** Pixel size; defaults to 20 to match the type scale. */
  size?: number;
  /** Renders as a filled glyph. */
  filled?: boolean;
  /** Accessible name; omit for decorative icons. */
  label?: string;
  className?: string;
}

/** Material Symbols Outlined glyph (self-hosted font, no icon component library). */
export function Icon({ name, size = 20, filled = false, label, className }: IconProps): ReactNode {
  return (
    <span
      className={['material-symbols-outlined', className].filter(Boolean).join(' ')}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
      }}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {name}
    </span>
  );
}
