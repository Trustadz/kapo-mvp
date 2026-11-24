import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildReleaseChangelog,
  parseFragmentFilename,
  readFragments,
  releaseChangelog,
  renderFragments,
  validateFragments,
} from '../../.github/scripts/changelog.mjs';

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'kapo-changelog-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('changelog fragment filenames', () => {
  it('accepts a number or a +slug before the category', () => {
    expect(parseFragmentFilename('105-save-feedback.improved.md')).toEqual({
      slug: '105-save-feedback',
      category: 'improved',
    });
    expect(parseFragmentFilename('+changelog-fragments.changed.md')).toEqual({
      slug: 'changelog-fragments',
      category: 'changed',
    });
  });

  it('rejects documentation, unknown categories and malformed names', () => {
    expect(parseFragmentFilename('README.md')).toBeNull();
    expect(parseFragmentFilename('note.improvement.md')).toBeNull();
    expect(parseFragmentFilename('note.md')).toBeNull();
    expect(parseFragmentFilename('Note.added.md')).toBeNull();
  });
});

describe('changelog fragments', () => {
  it('reads fragments in filename order and ignores the README', () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, 'README.md'), '# Docs\n');
    writeFileSync(join(directory, '20-second.fixed.md'), 'Second.\n');
    writeFileSync(join(directory, '10-first.added.md'), 'First.\n');

    expect(readFragments(directory).map((fragment) => fragment.file)).toEqual([
      '10-first.added.md',
      '20-second.fixed.md',
    ]);
  });

  it('reports invalid, empty and heading-bearing fragments', () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, 'bad.improvement.md'), 'Bad category.\n');
    writeFileSync(join(directory, 'empty.added.md'), '\n');
    writeFileSync(join(directory, 'heading.fixed.md'), '## Heading\n');

    const errors = validateFragments(directory);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('bad.improvement.md');
    expect(errors[1]).toContain('empty.added.md');
    expect(errors[2]).toContain('heading.fixed.md');
  });

  it('renders sections in release order with bullets and continuation lines', () => {
    const rendered = renderFragments([
      { file: 'a.added.md', slug: 'a', category: 'added', body: 'First.\nSecond line.' },
      { file: 'b.upgrade.md', slug: 'b', category: 'upgrade', body: 'Migration `008`.' },
      { file: 'c.improved.md', slug: 'c', category: 'improved', body: '**Fast.** Better.' },
    ]);

    expect(rendered).toBe(
      [
        '### Added',
        '',
        '- First.',
        '  Second line.',
        '',
        '### Improved',
        '',
        '- **Fast.** Better.',
        '',
        '### Upgrade notes',
        '',
        '- Migration `008`.',
      ].join('\n'),
    );
  });
});

describe('folding fragments into the changelog', () => {
  const source = [
    '# Changelog',
    '',
    '## Unreleased',
    '',
    'Existing manual entry.',
    '',
    '## 0.4.1 — 2026-11-22',
    '',
    '### Changed',
    '',
    '- Old release.',
    '',
  ].join('\n');

  it('moves Unreleased and fragments into a dated version section', () => {
    const next = buildReleaseChangelog(source, 'v1.2.3', '2026-11-24', [
      { file: 'a.added.md', slug: 'a', category: 'added', body: 'New thing.' },
    ]);

    expect(next).toContain(
      [
        '## Unreleased',
        '',
        '## 1.2.3 — 2026-11-24',
        '',
        'Existing manual entry.',
        '',
        '### Added',
        '',
        '- New thing.',
        '',
        '## 0.4.1 — 2026-11-22',
      ].join('\n'),
    );
    expect(next.match(/^## Unreleased$/gm)).toHaveLength(1);
  });

  it('rejects an invalid version, date or empty release', () => {
    expect(() => buildReleaseChangelog(source, '1.2', '2026-11-24', [])).toThrow(
      'expected X.Y.Z',
    );
    expect(() => buildReleaseChangelog(source, '1.2.3', '24-11-2026', [])).toThrow(
      'expected YYYY-MM-DD',
    );
    expect(() =>
      buildReleaseChangelog('# Changelog\n\n## Unreleased\n', '1.2.3', '2026-11-24', []),
    ).toThrow('No changelog content to release');
  });

  it('writes the changelog and deletes only consumed fragments', () => {
    const directory = temporaryDirectory();
    const changelogPath = join(directory, 'CHANGELOG.md');
    const fragmentsDirectory = join(directory, 'changelog.d');
    writeFileSync(changelogPath, source);
    mkdirSync(fragmentsDirectory);
    writeFileSync(join(fragmentsDirectory, 'a.added.md'), 'New thing.\n');
    writeFileSync(join(fragmentsDirectory, 'README.md'), 'docs\n');

    const count = releaseChangelog({
      version: '1.2.3',
      date: '2026-11-24',
      dir: fragmentsDirectory,
      changelogPath,
    });

    expect(count).toBe(1);
    expect(readFileSync(changelogPath, 'utf8')).toContain('- New thing.');
    expect(readFragments(fragmentsDirectory)).toEqual([]);
    expect(readFileSync(join(fragmentsDirectory, 'README.md'), 'utf8')).toBe('docs\n');
  });
});
