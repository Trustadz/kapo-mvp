import { avatarPalette, initials } from '@/lib/avatar';
import { cn } from '@/lib/cn';
import styles from './Avatar.module.css';

export type AvatarSize = 24 | 32 | 40 | 48 | 64;

export interface AvatarProps {
  name: string;
  /** Uploaded avatar path, e.g. /api/me/avatar/<id>. */
  src?: string | null;
  size?: AvatarSize;
  /** Override the deterministic palette index (1–4). */
  palette?: number;
  /** Set when the name is already rendered next to the avatar. */
  decorative?: boolean;
  className?: string;
}

/** Actor avatar: uploaded image when present, otherwise initials on a token pair. */
export function Avatar({
  name,
  src,
  size = 32,
  palette,
  decorative = false,
  className,
}: AvatarProps) {
  const index = palette ?? avatarPalette(name);
  return (
    <span
      className={cn(styles.avatar, className)}
      data-palette={index}
      style={{ ['--avatar-size' as string]: `${size}px` }}
      title={name}
      aria-hidden={decorative || undefined}
    >
      {src ? (
        // Uploaded avatar paths are local; a plain img avoids remote-domain config.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className={styles.image} />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
      {decorative ? null : <span className="visually-hidden">{name}</span>}
    </span>
  );
}
