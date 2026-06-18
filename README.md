# Ship's Log

**A self-hostable, git-backed hub for everything about your boat — trip logs,
maintenance, inventory, costs, manuals, and vendors — in one fast, mobile-friendly
web app. Fork it, point it at your boat, and go.**

Boat ownership scatters information everywhere: the paper logbook, the running
repair list, the safety-gear expiry dates you can never remember, the receipts,
the engine manual in a drawer. Ship's Log pulls it all into a single, searchable,
editable hub that **you own** — your data lives as plain Markdown files in a git
repo (no database, no third-party cloud), so it's portable, versioned, and yours
forever.

It's designed to run for a **single boat**: the app is generic, and everything
boat-specific — the name, the specs, the trips, the welcome page your guests see —
comes from your data.

## Try it in under a minute

```bash
npm install
npm run build:ui
npm start                # → http://localhost:8080
```

With no data repo configured, the app boots in **demo mode** over a fully-populated
sample boat, *Valkyrie* (a 1985 Catalina 25) — six trips, eight maintenance items,
a stocked inventory, a cost ledger, vendors, and manuals — so you can click through
the whole UI, including the owner's Costs page, with no setup or login.

> Tip: a screenshot of the demo near the top of this README makes a great first
> impression — drop one in once you've taken the tour.

## Why you'd want it

- **A real logbook + maintenance tracker, not a spreadsheet.** Log a trip with
  waypoints, weather, crew, and findings; a finding ("jib halyard frayed") links
  straight to the maintenance item it creates, which links to the vendor who fixed
  it and the cost it incurred. Inventory items with inspection/service/expiry dates
  automatically surface as overdue/due work — your fire extinguisher tells *you*
  when it's time.
- **Your data is just files in git.** One Markdown-plus-frontmatter file per record.
  Human-readable, diff-able, conflict-resistant, and backed up the moment you push.
  No database to run or migrate.
- **Bring your crew aboard — without showing them the bills.** Three roles: a public
  **Welcome** page for guests (boat rules, what to bring, safety brief), **crew** who
  see everything *except* costs, and **owners** who see everything and manage users.
  Cost data is stripped **server-side** for non-owners — it never reaches the
  browser, not just hidden in the UI.
- **Partial entries are first-class.** Jot a trip as a single line of free text now;
  flesh it out (or let Cowork flesh it out) later. Blank fields stay blank.
- **Photos included.** Upload from your phone; the server compresses and stores them
  right in the data repo, referenced from the record.
- **AI on your terms — never inside the app.** The app itself runs no AI. Instead,
  [Claude Cowork](#working-with-claude-cowork) clones your data repo, reads a
  half-written trip and its photos, researches the fix against the web *and your
  boat's own manuals*, writes the narrative, opens the linked maintenance item, and
  pushes it back. The app picks the change up on its next sync.
- **Self-hosted and private.** Ships as a Docker image that runs behind a tunnel
  with **no exposed ports**; the app gates itself with signed-cookie sessions.

## The eight pages

**Welcome** (public) · **Trip logs** · **Maintenance** · **Inventory** · **Costs**
(owner-only) · **Manuals** · **Vendors** · **Search** (across everything). A
role-aware sidebar hides what you can't see, and a maintenance badge counts what
needs attention.

## How it works

Ship's Log is **two separate git repositories**, and that split is the whole idea:

- **The app repo** (this one) is *code only* — generic, public, no boat data. You
  **clone** it to run it and `git pull` for updates. *(Forking is optional — only if
  you want your own copy to modify.)*
- **Your data repo** is a *separate, private* repo holding your boat's data
  (`boat.yaml`, trips, maintenance, photos), which you create from the included
  [`data-template/`](data-template/) — one per boat.

Everything syncs through the **private data repo**; the public app repo is never in
the sync loop, so your data never becomes public:

```
   app repo (public, CODE only)        your data repo (PRIVATE, your boat's DATA)
        │  clone / pull                        ▲   ▲
        ▼  (install + update only)       clone │   │ push
   ┌────────────────┐                          │   │
   │ the running app │── clone · pull · push ───┘   │
   │   (Docker)      │                              │
   └────────────────┘                              │
   ┌────────────────┐                              │
   │  Claude Cowork  │── clone · edit · push ───────┘
   └────────────────┘
```

- **Git is the source of truth.** Each record is a Markdown file (YAML frontmatter +
  a narrative body). The running app is the single server-side writer — it commits
  every in-app change to the **data** repo, pushes, and pulls on a timer; conflicts
  are surfaced safely and it never force-pushes.
- **Cowork works on your private data repo — never the app repo.** It clones your
  data repo, finishes a half-written trip (researching the web *and your own
  manuals*), and pushes; the app converges on its next pull. **No AI runs inside the
  app itself.**
- **Built end-to-end in TypeScript** — a Vite + React single-page app, a thin Node
  (Express) server, and a headless data layer — to keep self-hosting approachable.

## Roles & access

| Role      | Sign-in            | Sees                                              | Can change                                              |
|-----------|--------------------|---------------------------------------------------|---------------------------------------------------------|
| **guest** | none               | the public Welcome page only                      | nothing                                                 |
| **crew**  | yes                | everything **except costs** (stripped server-side)| add/edit trip logs; mark maintenance complete; add photos |
| **owner** | yes (admin)        | everything, including costs                        | full create/edit/delete across all collections; user management |

Costs are owner-only and redacted at the API boundary — across reads, search,
derived views, **and** write responses. A test suite guards that no monetary value
ever reaches a crew or guest response.

## Working with Claude Cowork

Your data repo is **self-documenting for AI**: forked from `data-template/`, it
carries — *inside the data repo itself* — an `AGENTS.md` (conventions + the
research-and-write workflow), a `SCHEMA.md` (every field, id rule, cross-link, and
the owner-only cost tags), and a ready-to-run `complete-trip` skill. So the moment
Cowork clones your boat's repo, it knows how to finish a half-written entry
correctly — researching against your own `manuals/`, keeping cross-links intact, and
never leaking a dollar figure into a crew-facing narrative. Cowork works purely over
git; it never touches the running app.

## Self-hosting

Ship's Log ships as a Docker image. **Two things are required no matter how you
host it:** a private data repo (from `data-template/`) and a deploy credential for
it. Then run it however you like:

- **Docker behind your own reverse proxy** (the common case) — `docker compose up -d`
  serves it on `:8080`; put Caddy / nginx / Traefik / Cloudflare in front for HTTPS.
- **Docker behind a [Pangolin](https://github.com/fosrl/pangolin) tunnel** with no
  exposed ports — the included `docker-compose.vps.yml` override (the reference
  deployment).
- **Without Docker** — `npm ci && npm run build:ui && npm start` behind any HTTPS
  proxy.

The full, copy-paste, beginner-friendly walkthrough for all of these — create the
data repo, mint the credential, set secrets, run it, wire up HTTPS, and use Cowork —
is in **[`docs/DEPLOY-CHECKLIST.md`](docs/DEPLOY-CHECKLIST.md)**.

```bash
docker compose up -d --build                                          # Docker, on :8080 (add your own TLS proxy)
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d  # Docker + Pangolin tunnel (no open ports)
```

Key environment variables (full reference in the deploy checklist):

| Variable | Purpose |
|---|---|
| `DATA_REPO_URL` | your private data repo; cloned on first boot. Unset (with no `DATA_DIR`) ⇒ demo mode. |
| `DATA_SSH_KEY_PATH` *or* `DATA_REPO_TOKEN` | the deploy credential (SSH key or fine-grained PAT) for that repo. |
| `SESSION_SECRET` | signs session cookies (required outside demo). |
| `OWNER_USERNAME` / `OWNER_PASSWORD` | seed the first owner on first boot. |
| `USERS_PATH` | the hashed-credential store — kept on its own volume, never in the data repo. |
| `PULL_INTERVAL` | sync cadence in seconds (default 300). |
| `COOKIE_SECURE` | `true` behind TLS (also enables HSTS/CSP hardening); `false` for local http. |

The users store (`users.json`) is deployment state, not data — keep it on its own
volume and **back it up**; it's the one thing the data repo can't regenerate.

## Optional: connect an AI Purser

Ship's Log can optionally connect to a self-hosted, OpenAI-compatible AI agent
that acts as the boat's "Purser" — an in-app chat that knows who is talking to it
and can answer questions about the boat, the voyage, or anything else you teach it.
This is entirely optional and owner-authorized.

**Off by default.** With `ASSISTANT_URL` unset the feature is entirely absent — no
nav item, no route, and `/api/me` returns `assistant.enabled: false`. The app is
fully functional without it. To run with no Purser at all, simply leave
`ASSISTANT_URL` unset (the default).

**VPS secret file required even when unused.** `docker-compose.vps.yml` always
mounts `secrets/assistant_api_key` as a Docker secret (alongside the other three).
If you are not enabling the Purser, create an empty placeholder so the secret
mount succeeds: `touch secrets/assistant_api_key`. Alternatively, remove the
`assistant_api_key` entry from both the `secrets:` block and the service's
`ASSISTANT_API_KEY_FILE` env line in your copy of `docker-compose.vps.yml`.

**Prerequisites.** You need a self-hosted agent that exposes an OpenAI-compatible
HTTP endpoint (`POST /v1/chat/completions` with streaming). The agent can run on
the same host, another container, or a nearby machine. Any OpenAI-compatible
server works; [Nous Research Hermes](https://huggingface.co/NousResearch) agents
with the Hermes-style API server are one example.

**Configuration.** Set these variables in your `.env` or compose override:

| Variable | Purpose |
|---|---|
| `ASSISTANT_URL` | Base URL of the agent (e.g. `http://host.docker.internal:11434`). Setting this enables the feature. |
| `ASSISTANT_API_KEY` | Bearer token for the agent, if it requires one. Or supply `ASSISTANT_API_KEY_FILE` (VPS secret form). |
| `ASSISTANT_MODEL` | Model string forwarded to the agent (the agent may treat it as a passthrough). |
| `ASSISTANT_LABEL` | UI label for the nav item and page (default: `Ask the Purser`). |
| `ASSISTANT_SESSION_ID` | Shared conversation id for the communal thread (default: `shiplog`). |

**Container→host networking.** When the agent runs on the Docker host (the common
case), the app container reaches it via `host.docker.internal`. The compose file
already wires `extra_hosts: host.docker.internal:host-gateway` for you. Set:

```
ASSISTANT_URL=http://host.docker.internal:<port>
```

**Security.** Keep the agent port reachable by the container but **not publicly
exposed** — block it at the host firewall. The Pangolin tunnel only fronts Ship's
Log itself, not the agent. Set `ASSISTANT_API_KEY` if the agent supports it.
**Identity is server-derived**: the app injects the verified session username into
every request; a crew member cannot impersonate the owner, and guests never reach
the feature (it is owner + crew only).

**Per-crew memory (Hermes agents).** The app sends an `X-Hermes-Session-Key`
header equal to the logged-in username. A Hermes agent uses this to maintain a
separate long-term memory model per person, so crew members get responses shaped
to their own history with the boat. Non-Hermes agents ignore the header — the
chat still works fine.

**Cost note.** The assistant chat is intentionally not cost-redacted. The agent
receives free-text messages and returns free-text responses; it does not receive
dataset JSON. If a crew member asks it a cost question it may answer based on
whatever the agent was trained on — the owner accepted this by enabling the
feature. The normal app pages remain server-side redacted for crew and guests.

**Visual inspection (Phase 2).** The chat composer lets you attach a photo alongside
your message — for example, a shot of a possibly-frayed line or a corroded fitting.
The server compresses the image (reusing the same pipeline as the photo log:
longest edge ≤ 2048 px, JPEG) and forwards it to the agent as an `image_url` content
part so the agent can *see* it and reason about what it shows. The agent can then
act through its data-repo tools as usual — for example, opening a maintenance item.
Chat photos are used only as vision input for that turn and are **not persisted** as
files by the app (the agent may persist to the data repo if it logs maintenance).

> **Vision model required.** The configured agent model must support image input.
> A text-only model will silently ignore the attached photo. Verify your model's
> vision capability before relying on photo-based queries.

## Development

```bash
npm test            # full Vitest suite (server/data in node, UI in jsdom)
npm run typecheck   # tsc for both the server and the UI
npm run dev         # API on :8080 (watch mode)
npm run dev:ui      # Vite dev server on :5173, proxying /api + /photos + /files → :8080
```

For UI work, run `npm run dev` and `npm run dev:ui` together — the SPA develops
against the real server in demo mode. `npm run build:ui` produces the production
bundle the server serves itself.

Conventions (TDD, the layout rules, and the cost-redaction invariant) live in
[`CLAUDE.md`](CLAUDE.md); the design and rationale are in
[`docs/superpowers/specs/`](docs/superpowers/specs/).

### Layout

```
src/data/    headless data layer — parse/serialize records, schemas, cross-links,
             derived views (overdue/due), search. The only thing the server imports.
src/server/  the REST API — auth, server-side redaction, the single serialized
             writer, the git/sync engine, photo + static-file serving.
src/ui/      the SPA (Vite + React + TS) — a pure API client; the design system in
             styles/app.css is ported from the original prototype (docs/prototype/).
demo/        the populated "Valkyrie" sample dataset (used by tests + demo mode).
data-template/  the empty seed you copy to start your own private data repo —
             ships AGENTS.md, SCHEMA.md, and the complete-trip Cowork skill.
docs/        design spec, deploy checklist, and the prototype design source.
```

## Status & license

The app is feature-complete and covered by a green test suite (data layer, REST
API + auth + redaction, the SPA, the git sync engine, and the Cowork tooling). What
remains is operator work for *your* deployment — see the deploy checklist.

Released under the ISC license. Built with [Claude Code](https://claude.com/claude-code).
