# text-coach

KISS writing assistant in the browser. Drop in your Anthropic API key, paste a draft, get surgical edit suggestions you can apply or dismiss one click at a time.

Vibe coded by Claude, nudged toward the right debugging path by an actual human.
No backend, no telemetry — the page talks straight to `api.anthropic.com` from your browser. Your key lives in `localStorage`.

## Setup

```bash
bun install
```

Get an Anthropic API key at https://console.anthropic.com/ and paste it into the "Set API key" panel the first time you open the app.

## Usage

```bash
bun run dev      # vite on :8080, bound to all interfaces
bun run build    # tsc + vite build → dist/
bun run preview  # serve the build on :8080
bun run lint
```

Pick a style preset (Discord, email, commit message, tweet, formal doc, plain), type in the textarea, pause for ~1.5s, and suggestions appear on the right. **Apply** rewrites the text and re-anchors the rest; **Dismiss** drops one; edits during a pending request abort it and re-query.

## How it works

```
You type  ──debounce 1.5s──▶  Claude (Haiku, tool_use: propose_edits)
                                        │
                                        ▼
                              [(start, end, replacement, rationale, category), ...]
                                        │
                                        ▼
Apply  ──▶  splice text, shift offsets of later edits, mark overlapping ones superseded
Reject ──▶  mark as rejected
Edit   ──▶  mark pending suggestions stale, re-query
```

Edits are character offsets in the *original* text the model saw. The client tracks state per suggestion (`pending` / `applied` / `rejected` / `superseded` / `stale`) so history stays coherent across rapid edits.

## Nginx (reverse proxy)

```nginx
location / {
    proxy_pass http://text-coach:8080;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;  # map $http_upgrade above
}
```

If you're fronting the Vite dev server through TLS, set `server.hmr` in `vite.config.ts` to the public hostname + `clientPort: 443` so HMR's websocket survives the proxy.

## Stack

React 19 · TypeScript · Vite 8 · Tailwind 4 · Bun · Anthropic Messages API (tool use)
