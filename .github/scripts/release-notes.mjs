import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Writes the GitHub Release body for a published Kapo version.
 *
 * The body combines:
 *   1. the curated `## Unreleased` (or `## <version>`) block from CHANGELOG.md,
 *      which carries upgrade notes operators must read before pulling, and
 *   2. GitHub's generated PR list, grouped by `.github/release.yml`.
 *
 * Usage: VERSION=0.4.1 PREVIOUS_TAG=v0.4.0 GITHUB_REPOSITORY=owner/repo \
 *        GITHUB_TOKEN=... node .github/scripts/release-notes.mjs notes.md
 */

const [outputPath] = process.argv.slice(2)

const version = process.env.VERSION?.trim()
const previousTag = process.env.PREVIOUS_TAG?.trim() || ''
const repository = process.env.GITHUB_REPOSITORY?.trim()
const token = process.env.GITHUB_TOKEN?.trim()

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!outputPath || !version) {
  fail('Usage: VERSION=... node .github/scripts/release-notes.mjs <output-file>')
}
if (!repository || !token) {
  fail('GITHUB_REPOSITORY and GITHUB_TOKEN are required.')
}

function changelogSection() {
  let source
  try {
    source = readFileSync('CHANGELOG.md', 'utf8')
  } catch {
    return ''
  }

  const lines = source.split('\n')
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const heading = new RegExp(
    `^##\\s+(?:Unreleased|${escapedVersion})(?:\\s|—|-|$)`,
    'i',
  )
  const start = lines.findIndex((line) => heading.test(line.trimEnd()))
  if (start === -1) return ''

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index
      break
    }
  }

  return lines.slice(start + 1, end).join('\n').trim()
}

async function generatedNotes() {
  const payload = {
    tag_name: `v${version}`,
    target_commitish: 'main',
  }
  if (previousTag) payload.previous_tag_name = previousTag

  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/generate-notes`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'kapo-release-workflow',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify(payload),
    },
  )

  if (!response.ok) {
    console.error(
      `::warning::Could not generate PR notes (HTTP ${response.status}); using the curated CHANGELOG section only.`,
    )
    return ''
  }

  const data = await response.json()
  return (data.body ?? '').trim()
}

const curated = changelogSection()
const generated = await generatedNotes()
const parts = [curated, generated].filter(Boolean)

if (parts.length === 0) {
  fail('No release notes were produced: CHANGELOG.md has no section and generated notes are empty.')
}

writeFileSync(outputPath, `${parts.join('\n\n---\n\n')}\n`)
console.log(
  `Wrote release notes for v${version}` +
    `${curated ? ' with the curated CHANGELOG section' : ''}` +
    `${generated ? ' and the generated PR list' : ''}.`,
)
