# Kapo

Kapo is a self-hosted household task and project management application where
**everything is a project**: a single Root project contains an unlimited tree of
projects, each with its own workflow, permissions, layout and activity history.
This repository contains the Next.js/SQLite implementation of the MVP.

- **Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), SQLite via
  `better-sqlite3`, CSS Modules with design tokens. No Tailwind, no component
  library.
- **Deployment:** one Docker Compose service with persistent data and backup volumes.
- **Source docs:** [`docs/build-spec.md`](docs/build-spec.md) is the binding
  engineering contract; [`product.md`](product.md) the product specification;
  `docs/reference/*.png` and the Penpot file are the visual source of truth.

---

## Feedback, bugs and feature requests

Use **[GitHub Issues](https://github.com/Trustadz/kapo-mvp/issues)** — one issue per item. Paste
screenshots directly into the issue body (drag and drop), and set one `type:` and one
`priority:` label plus a `status:` label when relevant. Known deferred and accepted decisions live
in issue [#14](https://github.com/Trustadz/kapo-mvp/issues/14), so they do not resurface as new
ideas.

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
| `KAPO_FORCE_SECURE_COOKIES` | unset (`0` in Compose) | Force `Secure` cookies behind TLS proxies |
| `KAPO_DISABLE_PURGE` | unset (`0` in Compose) | `1` disables the automatic trash purge (backups continue) |
| `KAPO_BACKUP_DIR` | `/backup` (Docker), `./data/backups` (dev fallback) | Rolling backup destination and container mount target |
| `KAPO_BIND` | `127.0.0.1` (Compose) | Host interface that publishes the app port |
| `KAPO_PORT` | `3000` (Compose) | Host port that publishes the app |
| `TZ` | `UTC` (Compose) | IANA timezone for the daily backup schedule and backup names |

Sessions are random, database-backed tokens (`sessions.token_hash` stores only a
SHA-256 hash), so no session secret is required.

## Run on a server (Docker Compose)

The repository is public; clone it directly on the server. Compose runs one
application container with two named volumes: `kapo-data` (SQLite database and
uploads) and `kapo-backup` (rolling backups).

### Prerequisites

- A Linux server with Docker Engine 24+ and Compose v2 (`docker compose version`).
- A DNS name pointing at the server and a TLS reverse proxy (Caddy, nginx or
  Traefik). Kapo itself serves plain HTTP on port 3000; terminate TLS at the
  proxy.
- Outbound network access for the first build (Docker pulls
  `node:24-bookworm-slim` and npm packages), or build/push the image elsewhere.
- Disk space for the database, uploads and the configured number of backup
  copies (both the database and uploads are stored per backup). The defaults
  keep 3 backups.

### First deploy

```bash
git clone https://github.com/Trustadz/kapo-mvp.git kapo
cd kapo
cp .env.example .env
# Edit .env and set at least:
#   KAPO_PUBLIC_URL=https://kapo.example.com
#   KAPO_PORT=3000
#   TZ=Europe/Amsterdam
# Keep KAPO_BIND=127.0.0.1 when a reverse proxy runs on this host;
# set KAPO_BIND=0.0.0.0 only for direct LAN access without a proxy.
docker compose up -d --build
```

Open `https://kapo.example.com/setup` and create the first Admin. An empty
installation redirects to `/setup` until one account exists; after setup the
same URL serves the app at `/login`.

What the Compose file provides:

- `restart: unless-stopped`, `init: true`, `stop_grace_period: 30s`, a
  `/healthz` healthcheck, `no-new-privileges` and rotated JSON logs
  (10 MB × 3).
- Non-root runtime user UID/GID **1001** (`kapo`); only `/app/data` and
  `/backup` are writable.
- `kapo-data:/app/data` (database + uploads) and `kapo-backup:/backup`
  (backups), both persistent named volumes.
- Publishes `${KAPO_BIND:-127.0.0.1}:${KAPO_PORT:-3000}:3000`: by default it
  listens on **localhost only**, suitable for a reverse proxy on the same host.
  Set `KAPO_BIND=0.0.0.0` only when clients reach Kapo directly over the LAN
  with no proxy and the port is protected by the firewall.
- `KAPO_PUBLIC_URL`, `KAPO_BIND`, `KAPO_PORT`, `KAPO_BACKUP_DIR` and `TZ` read
  from `.env`.
- A single replica: do not run multiple containers or Compose replicas against
  the same SQLite volume.

### TLS reverse proxy

Terminate HTTPS at the proxy and forward to the container. Send the original
`Host` and `X-Forwarded-Proto: https` so session cookies are marked `Secure`.
If your proxy cannot set that header, add `KAPO_FORCE_SECURE_COOKIES=1` to
`.env`.

Example Caddyfile:

```caddyfile
kapo.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Only expose SSH and ports 80/443 on the firewall. The Compose default binds the
app to `127.0.0.1`, so the proxy can reach it but the internet cannot.
`KAPO_BIND=0.0.0.0` is intended only for direct LAN access without a proxy; in
that case restrict the port with the firewall and do not expose it to the
internet.

### Volumes and permissions

The volume names shown in this README (`kapo-data`, `kapo-backup`) are the
logical names in `docker-compose.yaml`. Docker prefixes them with the Compose
project name, so the actual names depend on the checkout directory (for example
`kapo_kapo-data` or `13-backup_kapo-data`). Discover them with:

```bash
docker compose config --volumes       # logical names
docker volume ls | grep kapo          # actual names on this host
```

The restore and export commands below use `docker compose run`, which mounts the
same volumes automatically, so you rarely need the actual names. When copying a
volume with plain `docker run`, use the name from `docker volume ls`.

Named volumes inherit ownership from the image, so a normal
`docker compose up` needs no manual `chown`. If you copy data between hosts or
switch to bind mounts, the host directories must be writable by UID/GID 1001:

```bash
sudo mkdir -p /srv/kapo/data /srv/kapo/backup
sudo chown -R 1001:1001 /srv/kapo/data /srv/kapo/backup
```

To use host directories instead of named volumes, edit `docker-compose.yaml`
and replace the volume entries:

```yaml
    volumes:
      - /srv/kapo/data:/app/data
      - /srv/kapo/backup:/backup
```

Set `KAPO_BACKUP_DIR` in `.env` to the container-side backup path (default
`/backup`) if you change it; the Compose volume target follows that value. With
a bind mount, back up the host directory with your normal host backup tooling as
well as using Kapo's rolling backups.

### Logs and health

```bash
docker compose ps
docker compose logs -f kapo
curl -fsS http://127.0.0.1:3000/healthz
```

At startup the logs include `[kapo:backup] next run …` (and a purge message when
expired trash was removed).

### Updating

```bash
cd kapo
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Take a backup/volume snapshot before updating. Startup applies forward-only SQL
migrations; rolling back to an older image after a schema change is unsupported.

### Local Docker smoke test

The same file works locally:

```bash
docker compose up --build -d
# first visit: http://localhost:3000/setup
```

## Backups and restore

Admin users configure backups under **Settings → Application settings →
Backups**:

| Setting | Default | Notes |
| --- | --- | --- |
| Automatic daily backups | on | Runs inside the Next.js process; no cron job needed |
| Start time | `02:00` | Local wall-clock time in the server's `TZ` |
| Keep backups | `3` | 1–30; oldest folders are removed after each successful run |

Backups are written to `KAPO_BACKUP_DIR` (`/backup` in Compose, which is the
`kapo-backup` volume). Each run creates a timestamped folder:

```
/backup/kapo-YYYYMMDD-HHMMSS/
  kapo.db        consistent SQLite snapshot (single file, rollback journal)
  uploads/       copy of UPLOAD_DIR, when it exists
```

The database is captured with better-sqlite3's online backup API, not by copying
the live WAL file, so the snapshot includes every committed transaction. A run
is written to a temporary folder and renamed only after both parts succeed, so
an interrupted run never appears as a valid backup. Retention pruning only
touches folders matching `kapo-YYYYMMDD-HHMMSS`.

The scheduler is started by `src/instrumentation.ts` when the Node server boots
and recomputes the next run after every attempt and whenever an Admin saves the
settings (no restart required). Times are **server-local**: set `TZ` (Compose
defaults to `UTC`) to the household's timezone for 02:00 to mean local time.
Missed runs while the container was stopped are not replayed; the next run
happens at the following scheduled time.

Backups on the `kapo-backup` volume are not off-site copies. Copy them to
another machine regularly, for example (this writes a tarball to a host
directory; adjust the path):

```bash
sudo mkdir -p /srv/kapo-exports
docker compose run --rm --no-deps --user root \
  -v /srv/kapo-exports:/export --entrypoint sh kapo -c \
  'tar czf /export/kapo-backup-$(date +%Y%m%d-%H%M%S).tgz -C /backup .'
```

### Manual restore (no restore UI)

Restoring is intentionally manual. List the available backups, then stop the
container first so no process is writing the database, and replace the database
**and** uploads from one chosen backup. The `docker compose run` command below
mounts the service's volumes for you, so it does not matter whether the actual
volume names are `<project>_kapo-data` / `<project>_kapo-backup` or another
Compose project prefix (see [Volumes and permissions](#volumes-and-permissions)).

```bash
docker compose exec kapo ls -1 /backup
docker compose stop kapo

docker compose run --rm --no-deps --user root --entrypoint sh kapo -c '
  set -e
  rm -f /app/data/kapo.db /app/data/kapo.db-wal /app/data/kapo.db-shm
  cp /backup/kapo-YYYYMMDD-HHMMSS/kapo.db /app/data/kapo.db
  rm -rf /app/data/uploads
  cp -a /backup/kapo-YYYYMMDD-HHMMSS/uploads /app/data/uploads
  chown -R 1001:1001 /app/data
'

docker compose start kapo
```

Replace `kapo-YYYYMMDD-HHMMSS` with the folder chosen above. If a backup has no
`uploads/` folder (an installation with no avatars), leave `/app/data/uploads`
empty instead of copying.

Verify the restored database before relying on it:

```bash
docker compose exec kapo node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/kapo.db');
  console.log(db.pragma('integrity_check', { simple: true }));
  console.log(db.prepare('SELECT COUNT(*) AS projects FROM projects').get());
  db.close();
"
curl -fsS http://127.0.0.1:3000/healthz
```

Then sign in and open a known project. Restore from a different backup if the
integrity check fails; the previous database file has been removed, so keep
your off-site copy until the restore is verified.

The app also sweeps expired trash when it starts and every six hours via
`src/instrumentation.ts`, so no cron job or `scripts/` copy is needed in the
container. Set `KAPO_DISABLE_PURGE=1` to disable only that sweep (for example
while inspecting a restored snapshot). Backups have their own independent
schedule.

Demo accounts from `npm run db:reset` are for local testing only. Never seed
them on a public server; create the first Admin through `/setup`.

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
  backup/                rolling backup snapshot/pruning + daily scheduler
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

Mock data is optional. `npm run db:reset` seeds four accounts (password
`kapo1234`): `tristan` (application Admin), `maya` and `jules` (Users) and
`alex` (Viewer), a Root workflow, a project tree with Inbox items, favorites,
project roles, a private project and activity history. `npm run db:seed` seeds
without dropping an existing database.

## Licence

Application code is part of the Kapo project. Bundled fonts retain their
licences: Inter (SIL Open Font License 1.1) and Material Symbols (Apache 2.0) —
see `public/licenses/`.
