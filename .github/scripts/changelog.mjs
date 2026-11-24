import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Changelog fragments avoid the merge conflicts caused by every pull request
 * editing the same `## Unreleased` block. Each user-facing change adds one small
 * file under `changelog.d/`; release notes and `CHANGELOG.md` are assembled from
 * those files by the release process.
 */

export const FRAGMENT_DIRECTORY = 'changelog.d'
export const CHANGELOG_PATH = 'CHANGELOG.md'

export const FRAGMENT_CATEGORIES = [
  'added',
  'changed',
  'fixed',
  'improved',
  'security',
  'upgrade',
]

const CATEGORY_HEADINGS = {
  added: '### Added',
  changed: '### Changed',
  fixed: '### Fixed',
  improved: '### Improved',
  security: '### Security notes',
  upgrade: '### Upgrade notes',
}

/**
 * `<slug>.<category>.md`, optionally prefixed with `+` when there is no PR or
 * issue number yet. The slug only needs to be unique within the repository.
 */
const FRAGMENT_FILENAME =
  /^\+?([a-z0-9][a-z0-9._-]*)\.(added|changed|fixed|improved|security|upgrade)\.md$/

export function parseFragmentFilename(filename) {
  const match = FRAGMENT_FILENAME.exec(filename)
  if (!match) return null
  return { slug: match[1], category: match[2] }
}

function fragmentFileNames(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return entries
    .filter((name) => name.endsWith('.md') && name !== 'README.md' && !name.startsWith('.'))
    .sort((left, right) => left.localeCompare(right))
}

function readFragmentBody(dir, filename) {
  return fs
    .readFileSync(path.join(dir, filename), 'utf8')
    .replace(/\r\n/g, '\n')
    .trim()
}

/**
 * Returns human-readable problems instead of throwing so `check` can report
 * every invalid fragment in one pass.
 */
export function validateFragments(dir = FRAGMENT_DIRECTORY) {
  const errors = []
  for (const filename of fragmentFileNames(dir)) {
    if (!parseFragmentFilename(filename)) {
      errors.push(
        `${filename}: expected "<slug>.<category>.md" with category ${FRAGMENT_CATEGORIES.join(', ')}`,
      )
      continue
    }
    const body = readFragmentBody(dir, filename)
    if (!body) {
      errors.push(`${filename}: fragment is empty`)
      continue
    }
    if (/^#{1,6}\s/m.test(body)) {
      errors.push(`${filename}: fragment body must not contain Markdown headings`)
    }
  }
  return errors
}

export function readFragments(dir = FRAGMENT_DIRECTORY) {
  const fragments = []
  for (const filename of fragmentFileNames(dir)) {
    const parsed = parseFragmentFilename(filename)
    if (!parsed) {
      throw new Error(`Invalid changelog fragment filename: ${filename}`)
    }
    const body = readFragmentBody(dir, filename)
    if (!body) {
      throw new Error(`Changelog fragment is empty: ${filename}`)
    }
    fragments.push({ file: filename, slug: parsed.slug, category: parsed.category, body })
  }
  return fragments
}

function renderBullet(body) {
  const lines = body.replace(/\r\n/g, '\n').trim().split('\n')
  const first = (lines.shift() ?? '').replace(/^[-*]\s+/, '')
  const rendered = [`- ${first}`]
  for (const line of lines) {
    rendered.push(line.trim() === '' ? '' : `  ${line.replace(/\s+$/, '')}`)
  }
  return rendered.join('\n')
}

export function renderFragments(fragments) {
  const sections = []
  for (const category of FRAGMENT_CATEGORIES) {
    const entries = fragments.filter((fragment) => fragment.category === category)
    if (entries.length === 0) continue
    sections.push(
      [
        CATEGORY_HEADINGS[category],
        '',
        ...entries.map((fragment) => renderBullet(fragment.body)),
      ].join('\n'),
    )
  }
  return sections.join('\n\n')
}

/**
 * Folds the pending fragments and the current `## Unreleased` body into a new
 * dated version section. Used after publishing so the next release starts with
 * an empty Unreleased block and no leftover fragments.
 */
export function buildReleaseChangelog(source, version, date, fragments) {
  const normalizedVersion = version.replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(normalizedVersion)) {
    throw new Error(`Invalid version "${version}"; expected X.Y.Z`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${date}"; expected YYYY-MM-DD`)
  }

  const unreleasedHeading = /^##\s+Unreleased\s*$/m.exec(source)
  if (!unreleasedHeading) {
    throw new Error('CHANGELOG.md has no "## Unreleased" section')
  }

  const bodyStart = unreleasedHeading.index + unreleasedHeading[0].length
  const rest = source.slice(bodyStart)
  const nextHeading = /^##\s+/m.exec(rest)
  const bodyEnd = nextHeading ? bodyStart + nextHeading.index : source.length
  const unreleased = source.slice(bodyStart, bodyEnd).trim()
  const rendered = renderFragments(fragments)
  if (!unreleased && !rendered) {
    throw new Error('No changelog content to release')
  }

  const releaseBody = [unreleased, rendered].filter(Boolean).join('\n\n')
  const releaseSection = `## ${normalizedVersion} — ${date}\n\n${releaseBody}\n\n`
  return `${source.slice(0, unreleasedHeading.index)}## Unreleased\n\n${releaseSection}${source.slice(bodyEnd)}`
}

/**
 * Writes the folded changelog and deletes only the fragment files that were
 * consumed. Returns the number of consumed fragments.
 */
export function releaseChangelog({
  version,
  date = new Date().toISOString().slice(0, 10),
  dir = FRAGMENT_DIRECTORY,
  changelogPath = CHANGELOG_PATH,
} = {}) {
  const fragments = readFragments(dir)
  if (fragments.length === 0) {
    throw new Error('No changelog fragments to release')
  }
  const source = fs.readFileSync(changelogPath, 'utf8')
  const next = buildReleaseChangelog(source, version, date, fragments)
  fs.writeFileSync(changelogPath, next)
  for (const fragment of fragments) {
    fs.rmSync(path.join(dir, fragment.file))
  }
  return fragments.length
}

function usage() {
  console.error('Usage: node .github/scripts/changelog.mjs <check|render|release [version] [--date YYYY-MM-DD]>')
}

function main(argv) {
  const [command, ...args] = argv

  if (command === 'check') {
    const errors = validateFragments()
    if (errors.length > 0) {
      for (const error of errors) console.error(`::error::${error}`)
      process.exitCode = 1
      return
    }
    console.log('Changelog fragments are valid.')
    return
  }

  if (command === 'render') {
    const rendered = renderFragments(readFragments())
    console.log(rendered || 'No pending changelog fragments.')
    return
  }

  if (command === 'release') {
    const version = args.find((argument) => !argument.startsWith('--'))
    if (!version) {
      usage()
      process.exitCode = 1
      return
    }
    const dateIndex = args.indexOf('--date')
    const date = dateIndex === -1 ? undefined : args[dateIndex + 1]
    if (dateIndex !== -1 && !date) {
      usage()
      process.exitCode = 1
      return
    }
    const count = releaseChangelog({ version, date })
    console.log(`Released ${count} changelog fragment${count === 1 ? '' : 's'} in ${version}.`)
    return
  }

  usage()
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
}
