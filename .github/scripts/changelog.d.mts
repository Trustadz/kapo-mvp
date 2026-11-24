export type FragmentCategory =
  | 'added'
  | 'changed'
  | 'fixed'
  | 'improved'
  | 'security'
  | 'upgrade'

export interface ChangelogFragment {
  file: string
  slug: string
  category: FragmentCategory
  body: string
}

export const FRAGMENT_DIRECTORY: string
export const CHANGELOG_PATH: string
export const FRAGMENT_CATEGORIES: readonly FragmentCategory[]

export function parseFragmentFilename(
  filename: string,
): { slug: string; category: FragmentCategory } | null
export function validateFragments(dir?: string): string[]
export function readFragments(dir?: string): ChangelogFragment[]
export function renderFragments(fragments: ChangelogFragment[]): string
export function buildReleaseChangelog(
  source: string,
  version: string,
  date: string,
  fragments: ChangelogFragment[],
): string
export function releaseChangelog(options?: {
  version: string
  date?: string
  dir?: string
  changelogPath?: string
}): number
