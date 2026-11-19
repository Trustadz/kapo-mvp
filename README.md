# Kapo

Kapo is a self-hosted household task and project management application where
**everything is a project**: a single Root project contains an unlimited tree of
projects, each with its own workflow, permissions, layout and activity history.
This repository contains the Next.js/SQLite implementation of the MVP.

- **Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), SQLite via
  `better-sqlite3`, CSS Modules with design tokens. No Tailwind, no component
  library.
- **Deployment:** one Docker Compose service with a persistent local volume.
- **Source docs:** [`docs/build-spec.md`](docs/build-spec.md) is the binding
  engineering contract; [`product.md`](product.md) the product specification;
  `docs/reference/*.png` and the Penpot file are the visual source of truth.

---

## Requirements

- Node.js **24** and npm 11+ (npm is the only supported package manager).
- No external services. Fonts (Inter, Material Symbols Outlined) are
  self-hosted from npm packages; their licences live in `public/licenses/`.

## Run locally

```bash
npm ci
npm run db:reset      # create data/kapo.db, run migrations, seed demo data
npm run dev           # http://localhost:3000
```

### First run without demo data

An empty installation redirects to `/setup`, which creates the first application
Admin (username, email, password), the Root project, the default Root workflow
(*To do → In progress → Done*) and default settings. After creating the account
you are signed in.

`/setup` is only available while the installation has zero users. With seeded
data it redirects to `/login`.

### Seeded demo accounts

`npm run db:reset` seeds the mock household from build-spec §10. All accounts
use the password **`kapo1234`**:

| Username | Application role | Notes |
| --- | --- | --- |
| `tristan` | Admin | Owns the seeded Favorites; can manage Settings/Users |
| `maya` | User | Shared project access |
| `jules` | User | Shared project access |
| `alex` | Viewer | Read-only application-wide |

Seeded data includes the project tree (Home improvement → Renovate basement →
Find contractor, plus Paint hallway, Install hall shelf, Garden beds, Fix
kitchen tap; Household → Paint porch, Book boiler service; Personal → Plan
weekend trip), three Inbox captures, three favorites and activity history.

### Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (standalone output) |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit/integration suite |
| `npm run test:e2e` | Playwright end-to-end suite (install browsers first) |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Replace database contents with demo data |
| `npm run db:reset` | Drop the database, migrate and seed |
| `npm run db:purge` | Remove projects whose 30-day trash deadline passed |

`npm run test:e2e` expects Playwright browsers (`npx playwright install chromium`)
and a Playwright config; the tester owns `tests/**` and `playwright.config.ts`.

### Environment

Copy `.env.example` to `.env.local` if you need to override defaults:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/kapo.db` | SQLite database file |
| `UPLOAD_DIR` | `./data/uploads` | Profile picture uploads |
| `KAPO_PUBLIC_URL` | `http://localhost:3000` | Absolute URL for metadata |
| `KAPO_MIGRATIONS_DIR` | `./src/server/db/migrations` | SQL migration directory |
| `KAPO_FORCE_SECURE_COOKIES` | unset | Force `Secure` cookies behind TLS proxies |

Sessions are random, database-backed tokens (`sessions.token_hash` stores only a
SHA-256 hash), so no session secret is required.

## Docker

```bash
docker compose up --build -d
# first visit: http://localhost:3000/setup
```

- Multi-stage build on `node:24-bookworm-slim`; runs as the non-root `kapo` user.
- Next.js standalone output; the SQL migration files are copied to
  `/app/migrations` and read at runtime.
- Persistent state is the `kapo-data` volume mounted at `/app/data`
  (database + uploads). Back up this volume together with the container.
- The container healthcheck calls `GET /healthz` (unauthenticated, no details).
- Trash retention is automatic: the app sweeps expired trash when it starts and
  every six hours via `src/instrumentation.ts`, so no cron job, `scripts/` copy
  or npm command is needed in the container. Set `KAPO_DISABLE_PURGE=1` to
  disable the sweep (for example while restoring a database snapshot). It runs
  the same `purgeExpired()` implementation as `npm run db:purge`.
- Demo data is a development convenience: seed locally (or point
  `DATABASE_PATH` at a seeded volume) rather than shipping seed tooling in the
  production image.
- Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front of the
  container for HTTPS; the session cookie is marked `Secure` when
  `NODE_ENV=production` and the request is HTTPS (`X-Forwarded-Proto`).

## PWA

`public/manifest.webmanifest`, maskable icons and a minimal `public/sw.js` make
the app installable on iOS/Android/desktop. The service worker only caches
static assets and an offline page — authenticated pages and `/api/*` responses
are never cached. Offline editing is not supported.

## Architecture

```
src/app/                 App Router routes
  (app)/layout.tsx       authenticated shell wrapper (redirects to /login)
  login/, setup/         account entry screens
  api/                   JSON route handlers
src/components/
  ui/                    shared primitives (Button, Input, Menu, Dialog, …)
  shell/                 sidebar, top bar, mobile nav, capture, account menu
  auth/                  sign-in / first-install compositions
src/lib/                 client-safe shared types, formatting, validation, API client
src/server/
  db/                    connection, migration runner, migrations/*.sql, queries
  auth/                  password hashing, sessions, cookies, current-user guards
  addons/                extension contracts + empty registry
  seed.ts                demo data (build-spec §10)
src/styles/              tokens.css, base.css, layout.css
scripts/                 seed/reset/migrate/purge command-line entry points
public/                  logo, PWA assets, font licences
tests/                   Vitest and Playwright suites (owned by the tester)
```

### Data and migrations

- SQLite runs in WAL mode with `foreign_keys = ON` and a 5 s busy timeout.
- Migrations are forward-only `.sql` files in `src/server/db/migrations/`,
  recorded in `schema_migrations` and applied in a transaction on first
  database access (also via `npm run db:migrate`).
- The schema implements build-spec §5 exactly: users, sessions, projects,
  statuses, project roles, favorites, append-only audit events, trash actions,
  settings, addons and the FTS5 `project_search` index.
- IDs are UUID v4 strings; timestamps are ISO-8601 UTC strings. Sibling priority
  is unique per parent — reorders must be two-phase (offset, then rewrite)
  because the constraint is immediate.

### Authentication and authorization

- Passwords: `node:crypto` scrypt (`N=16384, r=8, p=1`), random salt, parameters
  stored with the hash; verification uses `timingSafeEqual`.
- Sessions: 30-day sliding expiry in the database; cookie `kapo_session`
  (`httpOnly`, `sameSite=lax`, `Secure` on production HTTPS). Only the SHA-256
  token hash is stored.
- Helpers in `src/server/auth`: `getSessionUser()`, `requireUser()`,
  `requireAdmin()`, `requireRole()`, `requireAppRole()`, `hashPassword()`, `verifyPassword()`,
  session and cookie utilities.
- Mutating API handlers must call `isSameOrigin(request)` (or use
  `rejectCrossOrigin()`) and return errors as
  `{ "error": { "code", "message", "fields"? } }` (`src/server/http.ts`).
- Application roles: Admin, User, Viewer. Viewers are read-only
  application-wide but may still edit their own profile, password, appearance
  and dashboard. Project permission logic lives in the projects domain.

### Design system

- `src/styles/tokens.css` mirrors the Penpot `Kapo` / `Kapo-Dark` /
  `Kapo-Theme-*` token sets for light and dark. Use the CSS custom properties
  rather than hard-coded colours:
  `--color-canvas`, `--color-surface`, `--color-surface-alt`, `--color-border`,
  `--color-input-border`, `--color-text`, `--color-muted`, `--color-soft`,
  `--color-brand`, `--color-brand-dark`, `--color-brand-light`,
  `--color-action`, `--color-accent`, `--color-warning`, `--color-warning-bg`,
  `--color-danger`, `--color-pulled`, `--color-disabled`, `--color-disabled-text`,
  `--avatar-1-*` … `--avatar-4-*`.
- Spacing `--space-1` (4px) … `--space-6` (32px); radii `--radius-sm|md|lg`
  (8/12/18); body/title/display font sizes through the same vars.
- Controls: buttons 40px tall (`--control-height`), inputs 42px
  (`--input-height`). Cards are white, 1px border, radius 12, no shadow.
- Theme is per user (`appearance`: light/dark/system) and applied before first
  paint; System follows the OS and updates live. The account menu's Appearance
  submenu calls `PATCH /api/me { appearance }` (implemented by the settings
  layer) and applies the theme optimistically.
- Layout: 244px sidebar (72px collapsed, tooltips + `aria-label`), 64px top bar
  with global capture and Search, mobile bottom bar
  Home / Root / Add / Inbox / Search, mobile header with Search and the account
  avatar. `src/app/(app)/layout.tsx` wraps authenticated pages and redirects to
  `/login` when signed out.

### Add-ons

`src/server/addons` ships the typed extension contracts and an **empty**
registry (no add-ons in this iteration). See the header comment in
`types.ts` for the `addon_data` / `settings.addons` storage contract. Add-ons
never bypass core invariants (permissions, workflow remapping, trash read-only).

## Building on the foundation

For feature builders working in this repository:

- UI primitives: `import { Button, Card, Field, Input, Menu, Dialog, Notice } from '@/components/ui';`
- Layout helpers: global classes `page-heading`, `page-subtitle`, `stack-3`,
  `stack-4`, `row-2`, `muted`, and token variables from `src/styles/tokens.css`.
- Session/user: `getSessionUser()` / `requireUser()` from
  `src/server/auth/current-user.ts` (or the `src/server/auth` barrel).
- Database: `getDb()` from `src/server/db/connection.ts`; schema/bootstrap
  helpers from `src/server/db/index.ts` (`insertWorkflow`, `indexProject`,
  `DEFAULT_PROJECT_SETTINGS`, `ROOT_WORKFLOW`, …).
- API responses: `jsonOk()` / `jsonError()` / `readJsonBody()` from
  `src/server/http.ts`; client calls via `postJson` / `patchJson` from
  `src/lib/api-client.ts`.
- Audit vocabulary: `AUDIT_ACTIONS` / `AUDIT_FIELDS` from `src/lib/audit.ts`.
- Shared types: `src/lib/types.ts` (`AppRole`, `Appearance`, `AuthUser`,
  `DashboardPreference`, `COLLECTION_VIEWS`, …). The default dashboard widget
  list is `[{ id: 'inbox', visible: true }, { id: 'recent', visible: true }]`.
- Routes owned elsewhere (do not duplicate): `/` Home, `/inbox`, `/p/**`,
  `/search`, `/trash`, `/profile`, `/settings`, `/users`, and `/api/me`,
  `/api/dashboard`, `/api/settings`, `/api/users`, `/api/projects`,
  `/api/inbox`, `/api/search`.
- The shell already depends on these contracts: `POST /api/projects`
  `{ parentId, title }` for capture and `PATCH /api/me` `{ appearance }` for the
  appearance menu. Both currently fail gracefully with an inline error/toast
  until the owning layers land.

## Testing

```bash
npm run typecheck                    # strict TypeScript
npm test                             # Vitest (tests/**)
npx playwright install chromium      # once, for e2e
npm run test:e2e                     # Playwright
```

Manual smoke test:

```bash
npm run db:reset
npm run build
npm run start -- -p 3100
curl -i http://localhost:3100/healthz      # 200 {"status":"ok"}
curl -i http://localhost:3100/login        # 200 sign-in card
```

## Security notes

- All mutations are validated server-side and checked for same-origin
  (`Origin`/`Host` plus `Sec-Fetch-Site`, with `SameSite=Lax` cookies).
- Sign-in is throttled in-process after repeated failures; put TLS and
  reverse-proxy rate limits in front of production deployments.
- Profile picture uploads are validated separately by the profile API; the
  foundation only defines `UPLOAD_DIR`.
- There is no email delivery or recovery flow: password resets are performed by
  an application Admin, matching the product specification.

## Project documentation

| Document | Purpose |
|---|---|
| [product.md](product.md) | Product & architecture specification (the product source of truth) |
| [dashboard.md](dashboard.md) | Dashboard MVP value review and decisions |
| [design-handoff.md](design-handoff.md) | Penpot page map, interactions and shared patterns |
| [docs/build-spec.md](docs/build-spec.md) | Engineering contract: routes, schema, domain rules, tokens, scopes |
| [docs/architecture.md](docs/architecture.md) | Implemented architecture, invariants, deployment, testing |
| [docs/add-ons.md](docs/add-ons.md) | **Developer guide for building add-ons** (registry contract, modes, fields, hooks, search, widgets, worked Assignee example) |
| [docs/architecture-review.md](docs/architecture-review.md) | Architecture review log (findings, resolutions, forward work) |
| [docs/design-review-app.md](docs/design-review-app.md) | Design fidelity review against Penpot |
| [docs/product-review.md](docs/product-review.md) | Product-owner acceptance review and scope compliance |
| [docs/build-log.md](docs/build-log.md) | Build log: decisions, phases, verification, review rounds |
| [docs/backlog.md](docs/backlog.md) | **Feedback & backlog register**: bugs, improvements, feature requests, deferred items and triage |

Mock data is optional. `npm run db:reset` seeds four accounts (password
`kapo1234`): `tristan` (application Admin), `maya` and `jules` (Users) and
`alex` (Viewer), a Root workflow, a project tree with Inbox items, favorites,
project roles, a private project and activity history. `npm run db:seed` seeds
without dropping an existing database.

## Licence

Application code is part of the Kapo project. Bundled fonts retain their
licences: Inter (SIL Open Font License 1.1) and Material Symbols (Apache 2.0) —
see `public/licenses/`.
