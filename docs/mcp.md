# Connect an AI assistant

Kapo can let your own AI assistant read and update the board for you. You ask in
plain language; the assistant looks things up and makes the changes through
Kapo's tools, **as you**.

Some examples:

- "What's in my inbox?"
- "Create 'Fix the shed' under Household."
- "Move Renovate basement to Done."
- "Assign Find contractor to Maya."
- "What changed on the kitchen last week?"

The assistant uses your permissions. It can only see and change what you can see
and change, and every change it makes is recorded in project history as you —
with a small marker showing it came through your AI assistant.

## What you need

- Kapo reachable from the machine running your AI client (URL and port).
- An AI client that supports **MCP over Streamable HTTP** — a recent Open WebUI,
  Claude Desktop, or any other MCP-capable client. A local llama.cpp server can
  be the model behind Open WebUI, but llama.cpp itself is not the MCP client.
- An Admin to turn the feature on once (below).

Kapo only listens; it never calls your model or the internet. Your client comes
to Kapo.

## Step 1 — Turn it on (Admin)

1. Sign in as an Application Admin.
2. Open **Settings → AI access (MCP)**.
3. Tick **Allow MCP access** and save.

It is off by default. Turning it off again blocks every token immediately;
nothing is deleted.

## Step 2 — Create your token

1. Open **Profile → AI access (MCP)**.
2. Give the token a name you will recognise — this is what history will show,
   for example `Open WebUI` or `Claude Desktop`.
3. Click **Create token**.
4. Copy the value (`kapo_mcp_…`) and paste it into your AI client now. **It is
   shown only once**; Kapo stores only a hash and cannot show it again.

You can create up to 10 active tokens and revoke any of them at any time. If you
lose a token, revoke it and make a new one.

## Step 3 — Connect your AI client

Use this connection information:

| Setting | Value |
| --- | --- |
| URL | `http://<kapo-host>:<port>/api/mcp` (use `https://` if Kapo is behind TLS) |
| Header | `Authorization: Bearer kapo_mcp_…` |
| Transport | MCP over Streamable HTTP (POST, stateless) |

There is no OAuth login and no session to keep. The token is the credential.

### Open WebUI

Open WebUI must support MCP servers over Streamable HTTP. In its admin settings,
open the MCP/tool-server section (the menu name changes between versions) and
add:

- **URL:** `http://<kapo-host>:<port>/api/mcp`
- **Header:** `Authorization: Bearer kapo_mcp_…`

Then enable the server for the model you use.

If Open WebUI runs in Docker, `localhost` inside the container is the container
itself, not your Kapo machine. Use the Kapo host's LAN address, `--network host`,
or `host.docker.internal` (Docker Desktop).

### Claude Desktop

Add Kapo to the MCP servers in Claude Desktop's configuration file and restart
the app:

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

The file is usually at `~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows.

If your build only supports stdio servers, bridge to the HTTP endpoint:

```bash
npx mcp-remote https://kapo.example.com/api/mcp \
  --header "Authorization: Bearer kapo_mcp_…"
```

### Any other client

Point it at the same URL and header. Before configuring the client, you can
confirm the server works from that machine:

```bash
export TOKEN='kapo_mcp_…'
export KAPO='http://192.168.1.50:3081'

curl -s "$KAPO/api/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}'

curl -s "$KAPO/api/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

If those work but your AI client does not, the problem is in the client's MCP
configuration or its container networking, not in Kapo.

## What the assistant can do

| It can | Examples |
| --- | --- |
| Find projects | Search by words; list the Inbox, Root and a project's children |
| Read a project | Title, status, parent, priority, workflow, add-on fields, recent history |
| Create a task | Add a child under a project; it enters the Inbox like quick capture |
| Rename / change status / archive | Move a task out of the Inbox, mark it done, archive it |
| Release from the Inbox | Clear the Inbox flag without changing the start status |
| Set add-on values | For example assign a project to a household member |
| Read history | Who changed what, and whether it came through the AI |

It follows the same rules as the web app: required add-ons still block leaving
the Inbox, trashed projects are read-only, and a Viewer's token can only read.

### What it cannot do

- Delete to Trash, restore, or empty the trash.
- Move a project to a different parent, or reorder siblings.
- Manage members, roles, project settings, workflows or application settings.
- Run bulk imports. Keep use interactive; every write goes through the same
  single-file database as the web app.

## History: what the AI did

Every change records the person, not the AI:

- The change appears in **project history** and the dashboard's **Recent
  changes** as you would any other edit.
- AI-originated changes also show a small **AI** badge on the avatar and a
  quiet `(via Open WebUI)` after the sentence.
- The label is the token name you chose. A client cannot rename itself.
- If you use `get_activity` through the assistant, each event includes the same
  `via` information.

An edit you make in the browser yourself has no AI badge.

## Turn it off or revoke a token

- **Revoke one token:** Profile → AI access (MCP) → **Revoke**. Any client using
  it stops working immediately.
- **Turn the whole feature off:** Settings → AI access (MCP) → untick and save.
  Every token is refused immediately. Tokens and history are kept, so turning
  it back on makes existing tokens work again.
- Revoking a token does not change history. The events keep their original
  label, because history is append-only.

## Security

- **Treat a token like a password.** Keep it out of screenshots, chat messages
  and git.
- **A token is exactly your access.** It cannot see private projects you cannot
  see, and a Viewer's token cannot write.
- **The label is set by the server.** It comes from the token you created, not
  from the AI's request, so the AI cannot pretend to be another person or agent.
- **Use HTTPS** whenever Kapo is not on a trusted local network. A bearer token
  and a password sent over plain HTTP can be read by anything on the path.
- **Revoke if it leaks**, then create a new one.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `403` with `mcp_disabled` | An Admin must enable **Settings → AI access (MCP)**. |
| `401` | The token is wrong, mistyped, or revoked. Create a new one. |
| Connection refused / timeout | Wrong host or port, firewall, or the client runs in a container where `localhost` means the container. Test with the `curl` commands above from the same machine as the client. |
| `404` | The path must be exactly `/api/mcp`. |
| Client connects but shows no tools | The client probably does not support MCP over Streamable HTTP. Update it or use a bridge such as `mcp-remote`. |
| `curl` works, client does not | Client MCP configuration, Docker networking, or a TLS certificate the client does not trust. |
| No AI badge in history | The change came from the web session, not through the token. Check `whoami` over MCP to confirm which token is connected. |
| Copy button does nothing | Copying works on plain HTTP too. If your browser still refuses, click the token once to select it and copy manually. |

## Technical reference

For client authors:

- JSON-RPC 2.0 over `POST /api/mcp`. Responses are `application/json`; `GET` is
  not supported and returns `405`.
- Methods: `initialize`, `ping`, `tools/list`, `tools/call`; notifications such
  as `notifications/initialized` return `202` with no body.
- Tool failures are returned as a normal result with `"isError": true` and a
  readable message, so the model can explain or retry. Unknown tools and bad
  arguments use JSON-RPC `-32602`.
- No sessions, no SSE stream, no server-initiated messages, no OAuth.
- Tools: `whoami`, `search_projects`, `get_project`, `list_inbox`,
  `list_children`, `get_workflow`, `get_activity`, `create_project`,
  `update_project`, `release_inbox`, `set_addon_values`.
- Add-on data is read through `get_project` and written through
  `set_addon_values`; there are no per-add-on tools.
