import { execFileSync } from 'node:child_process'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const bump = process.env.RELEASE_BUMP || 'patch'
const target = process.env.GITHUB_SHA || 'HEAD'
const tags = git('tag', '--list', 'v*', '--sort=-version:refname')
  .split('\n')
  .filter((tag) => stableTag.test(tag))

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!['patch', 'minor', 'major'].includes(bump)) fail('Choose patch, minor, or major.')

const latest = tags[0]
if (latest && !git('tag', '--merged', target, '--list', latest)) {
  fail(`${latest} is outside the history of the commit being released.`)
}

if (latest && git('rev-parse', `refs/tags/${latest}^{commit}`) === git('rev-parse', target)) {
  console.log(`version=${latest.slice(1)}`)
  console.log(`previous_tag=${tags[1] ?? ''}`)
  process.exit(0)
}

const [major, minor, patch] = (latest ?? 'v0.0.0').slice(1).split('.').map(BigInt)
const next = {
  patch: `${major}.${minor}.${patch + 1n}`,
  minor: `${major}.${minor + 1n}.0`,
  major: `${major + 1n}.0.0`,
}
console.log(`version=${next[bump]}`)
console.log(`previous_tag=${latest ?? ''}`)
