import { en } from './en';

/**
 * The English catalog defines the message tree. `nl` is typed against it, so
 * every locale must provide exactly the same keys and nested groups.
 */
export type Messages = typeof en;

type LeafPaths<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : T[K] extends Record<string, unknown>
          ? `${K}.${LeafPaths<T[K]>}`
          : never;
    }[keyof T & string];

/** Every string leaf in the catalog, as a dotted path. */
export type MessageKey = LeafPaths<Messages>;

/** Every plural group (`{ one, other }`) in the catalog, as a dotted path. */
export type PluralKey = {
  [K in keyof Messages['plurals'] & string]: `plurals.${K}`;
}[keyof Messages['plurals'] & string];
