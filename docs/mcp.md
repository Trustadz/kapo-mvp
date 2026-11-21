# AI access with MCP

**Audience:** a user or administrator connecting a local AI assistant to Kapo.
**Status:** core capability, **off by default**. Ships the MCP server, personal
MCP tokens, the AI marker in project history and the Admin toggle.
**Companion documents:** [architecture.md](architecture.md), [add-ons.md](add-ons.md)
§1 (why this is core, not an add-on).

---

## 1. What it is

Kapo exposes a **Model Context Protocol (MCP) server** so a user's own AI client
— a local llama.cpp model surfaced through Open WebUI, Claude Desktop, or any
other MCP-capable client — can read and write the board **as that user**.

- **Core, not an add-on.** Add-ons are typed data slices with no network I/O,
  no routes and no second process ([add-ons.md](add-ons.md) §1). MCP needs a
  transport, credentials and audit provenance, so it lives in the core.
- **Inbound only.** Kapo never calls an AI provider. Your model stays where you
  run it; the client calls Kapo.
- **Per-user.** Every user creates their own token. There is no shared or
  installation-wide AI account, and a token cannot see more than its owner.
- **Attributed.** Every write made through MCP is recorded in project history as
  the human owner, plus a marker naming the token/agent.

```
local LLM client (Open WebUI, Claude Desktop, …)
        │  HTTPS + Authorization: Bearer kapo_mcp_…
        ▼
POST /api/mcp  ──►  core MCP adapter  ──►  domain commands  ──►  SQLite
                         │                        │
                         └─ via: {channel:'mcp', agent:'Claude Desktop'}
                                                  └─► audit_events → Activity UI
```

## 2. Enable it

MCP is disabled on every installation, including existing ones.

1. Sign in as an Application Admin.
2. Open **Settings → AI access (MCP)**.
3. Tick **Allow MCP access** and save.

Turning it off again blocks every token immediately (the endpoint answers
`403 mcp_disabled` before it even reads a token). Existing tokens and history
are kept; no data is deleted.

## 3. Create a personal token

1. Open **Profile → AI access (MCP)**.
2. Enter a name — this is what history will show, for example `Claude Desktop`
   or `llama.cpp on the studio PC`.
3. **Create token** and copy the value. It is shown **once**; the database keeps
   only a SHA-256 hash, so it cannot be recovered later.

Revoke a token from the same section. Revocation is immediate; a revoked token
returns `401`. A user may hold up to 10 active tokens. Tokens keep working
through the API even when created by an Application Viewer — but a Viewer's
token can only read, because the domain rejects every write for that role.

The token label is the only thing history names. It is taken from the token row
by the server, never from the MCP request, so a client cannot relabel itself.

## 4. Connect a client

Endpoint:

```
https://kapo.example.com/api/mcp
```

Transport: **Streamable HTTP, POST only, stateless**. Send JSON-RPC 2.0 with
`Accept: application/json`. There is no SSE stream (`GET` returns `405`), no
session id to preserve, and no OAuth flow — use a bearer token.

```http
POST /api/mcp HTTP/1.1
Authorization: Bearer kapo_mcp_…
Content-Type: application/json
```

### Curl smoke test

```bash
export KAPO_MCP_TOKEN='kapo_mcp_…'
export KAPO_URL='http://127.0.0.1:3080'

curl -s "$KAPO_URL/api/mcp" \
  -H "Authorization: Bearer $KAPO_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}'

curl -s "$KAPO_URL/api/mcp" \
  -H "Authorization: Bearer $KAPO_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -s "$KAPO_URL/api/mcp" \
  -H "Authorization: Bearer $KAPO_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

A notification such as `notifications/initialized` returns `202` with an empty
body. Errors follow JSON-RPC codes (`-32600`, `-32601`, `-32602`), while tool
failures come back as a normal result with `"isError": true` and a readable
message, so the model can explain or retry.

### Open WebUI

Open WebUI must be new enough to speak **MCP Streamable HTTP**. In its admin
settings, add an external MCP/tool server:

- URL: `http://<kapo-host>:3080/api/mcp`
- Header: `Authorization: Bearer kapo_mcp_…`

Then attach the Kapo tool server to the model you use. Open WebUI calls Kapo
server-side, so no CORS configuration is involved. The label you gave the token
(for example `Open WebUI`) is what appears in Kapo history.

### llama.cpp

`llama-server` is the model backend, not an MCP client: it does not call Kapo
itself. Point an MCP-capable client (Open WebUI is the usual pairing) at the
endpoint above and let that client drive the tool calls. The model just chooses
tools; Kapo only sees the client's requests.

### Claude Desktop / other clients

Clients that support remote HTTP servers can use:

```json
{
  "mcpServers": {
    "kapo": {
      "type": "http",
      "url": "https://kapo.example.com/api/mcp",
      "headers": { "Authorization": "Bearer kapo_mcp_…" }
    }
  }
}
```

Older builds that only support stdio can bridge to the HTTP endpoint with
`mcp-remote`:

```bash
npx mcp-remote https://kapo.example.com/api/mcp \
  --header "Authorization: Bearer kapo_mcp_…"
```

## 5. Tools

All tools run as the token owner. Permission checks are the same domain checks
the web app uses; this layer does not add or widen any.

| Tool | Access | Purpose |
|---|---|---|
| `whoami` | read | Confirm the account and the token label history will show. |
| `search_projects` | read | Full-text search over titles and searchable add-on text. |
| `get_project` | read | Project, parent/breadcrumb, workflow, children, add-on fields/values, recent history. |
| `list_inbox` | read | The permission-filtered Inbox with parent context. |
| `list_children` | read | Direct children of a project; omit `projectId` for Root. |
| `get_workflow` | read | Status ids for this project and for its children. Read this before changing status. |
| `get_activity` | read | Paginated history, including who acted and whether it came via MCP. |
| `create_project` | write | Create a child under a writable parent; enters the Inbox like quick capture. |
| `update_project` | write | Rename, change status, archive/unarchive. |
| `release_inbox` | write | Release from the Inbox without changing the start status. |
| `set_addon_values` | write | Write add-on values through the generic validation/audit/search path. |

Notes:

- **No per-add-on tools.** Add-ons appear through `get_project` (resolved
  mode/availability, field definitions, current values, picker options) and are
  written through `set_addon_values`, exactly like the generic web editor.
- `create_project` takes only `parentId` and `title`; the start status comes
  from the parent's workflow, matching the capture flow.
- Status changes run the same Inbox-exit gate as the web app, so a Required
  add-on can block them. The tool returns the validation issues verbatim.
- Trashed projects are read-only; archived visibility follows the owner's
  "show archived" preference.
- Writes are synchronous and hold SQLite's single writer. Keep tool use
  interactive; do not script bulk imports through MCP.

## 6. How the AI marker works

Every audit event stores the human actor, so "who did it" is never ambiguous.
MCP writes additionally set three snapshot columns:

```
audit_events.actor_id     = the token owner       (always the human)
audit_events.via_channel  = 'mcp'                (NULL for web/API writes)
audit_events.via_agent    = the token label      ("Claude Desktop")
audit_events.via_token_id = the token id         (forensic link, no FK)
```

Project history renders the normal sentence followed by a quiet
`(via Claude Desktop)` and a small **AI** badge on the avatar. The badge has the
accessible title "Changed by an AI agent through MCP". Existing web writes are
unchanged and show no marker.

Because the audit log is append-only, the label is a **snapshot**: renaming or
revoking the token later does not rewrite history. Deleting a token row does not
touch its events.

The same provenance is available over MCP: `get_activity` returns `via` on each
event, and `whoami` returns the current token label.

## 7. Security model

- **The token is a password.** Treat `kapo_mcp_…` like a session: keep it out of
  git, screenshots and shared chats. Revoke and re-create if it leaks.
- **No elevation.** A token inherits exactly the owner's application role and
  project roles, including Viewer read-only and privacy rules. A token can never
  grant itself access to a private project.
- **No token in URLs.** Only the `Authorization` header is read.
- **Server-stamped provenance.** Clients cannot choose `via_agent`; it comes
  from the token row.
- **Opt-in and global off-switch.** With the toggle off, both the endpoint and
  token creation are refused.
- **Local-only dependency.** Kapo makes no outbound connection. If you use a
  hosted model through Open WebUI, that is your choice and outside Kapo.
- The endpoint is HTTP; put it behind TLS in production like the rest of the app.

## 8. Limits in this version

- No OAuth / dynamic client registration (personal bearer tokens only).
- No SSE `GET` stream, no server-initiated messages, no session resumption.
- No `resources/*` or `prompts/*` capabilities.
- No move, reorder, trash/restore or member-management tools yet.
- No per-add-on tools (deliberate; see [add-ons.md](add-ons.md) §1).
- No rate limit beyond token validation and the domain's own checks.

## 9. Manual verification

1. **Off by default** — fresh install: `curl` with any token returns `403`
   `mcp_disabled`; Profile shows the disabled notice.
2. **Enable** — Settings → AI access → save; Profile now offers token creation.
3. **Token shown once** — create one; the value starts with `kapo_mcp_`; reload
   the profile and it is gone from the page.
4. **Handshake** — `initialize` returns `serverInfo.name = "kapo"`;
   `tools/list` lists 11 tools; `notifications/initialized` returns `202`.
5. **Provenance** — `update_project` a title over MCP; open the project and see
   the **AI** badge and `(via <label>)`; `get_activity` shows the same `via`.
6. **Permissions** — create a Viewer's token and try `create_project`; expect
   `isError: true` with an access message, and no new project.
7. **Revocation** — revoke in Profile; the same token now returns `401`.
8. **Global off** — disable MCP in Settings; `curl` returns `403` and the
   profile section shows the disabled notice again.
