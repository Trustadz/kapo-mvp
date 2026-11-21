# Kapo automated tests

Two layers: a fast Vitest suite (unit, domain, API) and a Playwright end-to-end
suite against a real `next start` build.

## Commands

```bash
npm test                 # Vitest: unit + domain + API integration, headless
npm run test:e2e         # Playwright: builds .next-tests, runs on port 3301
npx tsc --noEmit --incremental false   # typechecks the tests too
```

Playwright browsers are cached in the workspace (`./data/pw-browsers`), so they
survive container resets:

```bash
PLAYWRIGHT_BROWSERS_PATH=./data/pw-browsers npx playwright install chromium
```

`npm run test:e2e` defaults `PLAYWRIGHT_BROWSERS_PATH` to that cache (falling
back to `/tmp/pw-browsers`). If the browser cannot be installed the e2e suite
cannot run in that environment; `npx playwright test --list` still works.

## Isolation rules

- Every Vitest file gets its own SQLite file (`data/test-<label>-<pid>-.db`),
  its own upload directory, and removes both on teardown. `DATABASE_PATH` is
  pointed at the temp file before the singleton connection is opened.
- The seed test runs the real `npm run db:seed` as a child process with
  `DATABASE_PATH` set to a temp file.
- Playwright uses `data/test-e2e.db`, `.next-tests/` and port 3301;
  `tests/e2e/start-server.mjs` rebuilds only when needed and resets the test
  database on every run.
- `data/kapo.db`, `data/projects.db` and `data/settings.db` are never opened.

## Layout

```
tests/helpers/   temp-db harness, deterministic fixture builder, next/headers
                 request-context mock, route-handler request helpers
tests/unit/      schema invariants, FTS helpers, auth primitives/CSRF/throttle,
                 add-on registry, HTTP conventions, Viewer shell rendering
tests/domain/    build-spec §6 rules: permissions + access modes (inherit/
                 custom), project lifecycle, workflow, trash + purge, search
tests/integration/ real route handlers: auth/setup, projects, accounts,
                 dashboard/members, project admin surface, new features
                 (workflow same-name replacement, view_fields, Tree bulk
                 move, Trash grouping), add-on plumbing (value writes,
                 modes/inheritance, registry sync, search, purge hooks,
                 layout/view field refs and card projection), seed script
tests/regressions/ architecture-review fix pass (AR-021…AR-052)
tests/e2e/       first-install + seeded desktop journeys, including the
                 Assignee add-on field-slot journey (Details, Properties,
                 view meta, dialog edit and unavailable filtering)
```

## Known expected failures

None at the time of writing. Historical documented xfails that are now fixed
and covered by normal passing tests:

- add-on registry `user` field validation (build-spec §12) — fixed, covered in
  `tests/unit/addons-registry.test.ts`.
- Activity target-title privacy for a child the viewer cannot read (access
  modes / AR-048) — fixed, covered in `tests/domain/access-modes.test.ts`.
