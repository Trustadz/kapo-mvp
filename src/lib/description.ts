/**
 * Serializable description/capability view models shared by server pages and
 * client components. Framework-free, like `src/lib/projects.ts`.
 */

/**
 * Core-owned fallback format. It is deliberately not an add-on provider: when
 * no provider is active, the description is edited as plain text.
 */
export const PLAINTEXT_DESCRIPTION_FORMAT = 'text@1';

export interface DescriptionProviderSummary {
  identifier: string;
  name: string;
  version: string;
  /** Format ids this provider can render/edit. */
  reads: string[];
  /** Format ids this provider can write. */
  writes: string[];
}

export interface ProjectDescriptionRecordView {
  body: string;
  format: string;
  plaintext: string;
  updatedAt: string;
}

export interface ProjectDescriptionData {
  provider: DescriptionProviderSummary | null;
  record: ProjectDescriptionRecordView | null;
  canEdit: boolean;
  /**
   * True when the stored record exists but the active provider (or no provider)
   * cannot read its format. The UI must show `plaintext` read-only.
   */
  unsupportedFormat: boolean;
}

export interface DescriptionFormatUsage {
  format: string;
  count: number;
}

/** Application-settings payload for the exclusive description capability. */
export interface DescriptionCapabilitySettings {
  /**
   * The effective active provider. When no choice has been saved yet and
   * exactly one provider is registered, this is that provider.
   */
  activeProvider: string | null;
  providers: DescriptionProviderSummary[];
  formatsInUse: DescriptionFormatUsage[];
}
