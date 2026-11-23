import { registerAddon } from './registry';
import { assigneeAddon } from './assignee';
import { descriptionMarkdownAddon } from './description-markdown';
import type { AddonDefinition } from './types';

/**
 * Server-side registration manifest — the only place an add-on definition is
 * registered (docs/add-ons.md §3). Each registration is isolated: a malformed
 * add-on is logged and skipped, never crashing the application.
 *
 * Importing `@/server/addons` runs this manifest once per server process. The
 * registry itself is still validated independently by `registry.ts`.
 */

function registerSafely(definition: AddonDefinition): void {
  try {
    registerAddon(definition);
  } catch (error) {
    console.error(`[kapo:addons] "${definition.identifier}" was not registered`, error);
  }
}

registerSafely(assigneeAddon);
registerSafely(descriptionMarkdownAddon);

export type {
  AddonCapability,
  AddonDefinition,
  AddonDashboardWidget,
  AddonFieldDefinition,
  AddonFieldOption,
  AddonFieldType,
  AddonFieldValue,
  AddonFormats,
  AddonHooks,
  AddonMode,
  AddonProjectConfig,
  AddonValidationIssue,
  AddonWidgetContext,
  AddonWidgetItem,
  ResolvedAddonConfig,
} from './types';
export { ADDON_CAPABILITIES, ADDON_MODES } from './types';
export {
  clearAddonsForTests,
  getAddon,
  listAddons,
  listCapabilityProviders,
  listPropertyAddons,
  registerAddon,
} from './registry';
