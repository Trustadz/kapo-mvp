# Changelog fragments

Add one small Markdown file here for each user-facing change, instead of editing
[`CHANGELOG.md`](../CHANGELOG.md). Two parallel pull requests then touch two
different files, so they cannot conflict in the changelog.

Release notes compile these fragments together with GitHub's generated PR list.
After publishing, `npm run changelog:release -- X.Y.Z` folds the fragments into a
dated section in `CHANGELOG.md` and removes them.

## Naming

```
<pr-or-slug>.<category>.md
```

Use the pull request number when it is known, otherwise a descriptive branch
slug. Keep it lowercase; prefix with `+` if there is no number yet:

```
105-save-feedback.improved.md
+changelog-fragments.changed.md
```

The category must be one of:

| Category   | Release section    |
| ---------- | ------------------ |
| `added`    | Added              |
| `changed`  | Changed            |
| `fixed`    | Fixed              |
| `improved` | Improved           |
| `security` | Security notes     |
| `upgrade`  | Upgrade notes      |

## Body

Write one bullet as it should read in the release notes. Do not add the leading
`-`; the compiler adds it. Keep continuation lines flush left.

```markdown
**Saving feedback.** The “Save changes” buttons now keep a **Saving…** label
visible for at least 600 ms, so a fast save no longer flashes past.
```

Upgrade notes should state the migration or action explicitly:

```markdown
Migration `008_example.sql` adds the example table. No manual action is required.
```

Do not add Markdown headings to a fragment. Use one fragment per change so each
entry can be reviewed on its own.

## Exemptions

Apply the `changelog-not-required` label for pull requests with no user-visible
change, such as tests, refactors or build-only work. The Changelog workflow
rejects direct edits to `CHANGELOG.md` and requires at least one new fragment
otherwise. The post-release fold PR also edits `CHANGELOG.md`; apply the label
there.

Run the checks locally with:

```bash
npm run changelog:check
npm run changelog:render
```
