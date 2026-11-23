# Markdown in Kapo

Kapo supports a deliberately small, safe Markdown subset for add-on
`longtext` fields. The goal is useful formatting without allowing raw HTML or
unsafe links.

## Supported

| Syntax | Result |
|---|---|
| Blank line | New paragraph |
| Single newline inside a paragraph | Line break |
| `**bold**` | **bold** |
| `*italic*` | *italic* |
| `` `code` `` | inline code |
| `[label](https://example.com)` | link (http/https only) |
| `- item`, `* item`, `+ item` | unordered list |
| `1. item`, `1) item` | ordered list |
| `\*`, `` \` ``, `\[`, `\]` etc. | escaped literal character |

## Not supported

- headings (`#`, `##`, …)
- blockquotes
- images
- tables
- nested lists
- autolinks
- raw HTML
- any URL scheme other than `http:` and `https:`

Raw HTML is displayed as text. A link with an unsafe or malformed URL is
rendered as plain label text rather than a clickable link.

## Where it appears

- **Add-on longtext fields** render the supported Markdown in Details and
  Properties and in the inline editor's Preview tab.
- **Collection views** (Kanban/Card/Tree/List) use a plain-text projection so
  Markdown block elements do not distort compact card rows.

The renderer and editor are shared UI primitives (`Markdown` and
`MarkdownTextarea`); add-ons do not ship their own Markdown implementations.
