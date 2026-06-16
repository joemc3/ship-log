# Ship's Log — Operator deploy & Cowork checklist

The app is fully built and **locally verified** (P1a–P3): data layer, REST API,
auth + server-side cost redaction, the SPA (8 pages), record writes, two-way git
sync, Docker/compose, and Cowork enablement. Full test suite is green (520 tests).

Everything below is a step **only you can do** — it needs your accounts, secrets,
and infrastructure. Nothing here blocks local development or the demo. Run the
sections in order. See `README.md` for the narrative version.

> Run the whole app locally with **no setup** first: `npm run build:ui && npm start`
> then open <http://localhost:8080> (demo mode over the bundled Valkyrie data).

---

## A. Create the private data repo (`valkyrie-log`)

The app code lives in this repo (`ship-log`, public/forkable). Your boat's data
lives in a **separate private repo**, seeded from `data-template/`.

```bash
# from anywhere
gh repo create valkyrie-log --private --clone
cd valkyrie-log
cp -R /Users/joemc3/tmp/sailing/data-template/. .   # ships AGENTS.md, SCHEMA.md, the Cowork skill, empty collections
# edit boat.yaml: name, make, model, year, hailingPort, specs{}, welcome{rules,whatToExpect,whatToBring,safety}
#   (optionally copy records from ../ship-log/demo/ as a starting point, or start empty and fill via the app)
git add -A && git commit -m "Seed Valkyrie data from data-template"
git push -u origin main
```

`AGENTS.md`, `SCHEMA.md`, and `.claude/skills/complete-trip/` come along
automatically, so Cowork is enabled the moment it clones this repo.

## B. Mint the deploy credential (pick ONE)

**SSH deploy key (recommended — repo-scoped, no expiry):**
```bash
ssh-keygen -t ed25519 -f ./valkyrie-deploy -C "shiplog-deploy" -N ""
# GitHub → valkyrie-log → Settings → Deploy keys → Add key → paste valkyrie-deploy.pub
#   ☑ Allow write access
# DATA_REPO_URL will be:  git@github.com:joemc3/valkyrie-log.git
```
**OR fine-grained PAT** scoped to just `valkyrie-log` with Contents: read+write;
use an `https://` `DATA_REPO_URL` and set `DATA_REPO_TOKEN`.

## C. Production secrets (Docker secrets — never commit)

`docker-compose.vps.yml` expects files under `./secrets/`:
```bash
mkdir -p secrets
openssl rand -hex 32           > secrets/session_secret     # SESSION_SECRET
printf 'a-strong-owner-pass'   > secrets/owner_password     # OWNER_PASSWORD
cp ./valkyrie-deploy             secrets/data_deploy_key      # the PRIVATE key (or a PAT)
chmod 600 secrets/*
```
Set `OWNER_USERNAME` (env), and `DATA_REPO_URL` to your repo's clone URL.

## D. VPS + Pangolin (mirror the DA-RAG deployment)

1. Confirm the host has Docker + the Pangolin/Gerbil stack and the external
   network: `docker network inspect pangolin`.
2. **Reconcile the pinned IP.** `docker-compose.vps.yml` pins `172.18.0.22` as a
   **placeholder**. Check the `pangolin` subnet and a free address; update the
   `ipv4_address` if it collides with Gerbil's IPAM.
3. Build the image where Docker Hub is reachable (your machine / CI), then bring
   it up on the VPS:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.vps.yml config   # validate (ports none, pangolin external)
   docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
   docker compose logs -f    # watch for "Bootstrapped owner" + "Sync scheduler running (pull every …)"
   ```
4. Add a **Pangolin tunnel resource** pointing at the app container
   (pinned `IP:8080`, **no SSO** — the app gates itself), and create/point a
   **DNS hostname** at it.
5. Open the hostname → log in as `OWNER_USERNAME` → **Admin** → add crew/owner
   accounts.

## E. Back up the users store

`users.json` lives in the **`shiplog-users` named volume** (deployment state,
outside git). Back it up, or rely on owner-bootstrap + re-adding crew to recreate
it. It must **never** enter the data repo (the app fails loud at boot if
`USERS_PATH` resolves inside `DATA_DIR`).

## F. Cowork — the "finish my half-written trip" workflow

1. Install/enable Claude Cowork.
2. Clone `valkyrie-log` (it already ships `AGENTS.md`, `SCHEMA.md`, and
   `.claude/skills/complete-trip/SKILL.md`).
3. Drop in a half-written trip + photos (see
   `data-template/examples/half-written-trip/` for the shape), then run the
   **complete-trip** skill: it reads the trip + photos, researches the fix (web +
   the boat's own `manuals/`), writes the narrative, opens the linked maintenance
   item with a two-way cross-link, commits, and pushes.
4. The deployed app converges on the push within `PULL_INTERVAL` (default 5 min).

---

## By-design notes

- **Demo mode** (no `DATA_DIR`/`DATA_REPO_URL`) serves the fictional Valkyrie
  dataset **including sample costs** (the demo viewer is owner-equivalent). That's
  intended for evaluation — don't point the public demo at a real, cost-bearing
  dataset.
- `docker build` needs Docker Hub egress; run it on your machine or CI.
- Cost data is owner-only and redacted **server-side** for crew/guest across
  reads, search, derived views, and write responses (the `redaction-golden` and
  doc-drift guard tests protect this — keep them green).

## Known non-blocking follow-ups (optional polish, not required to ship)

- **SPA sync-conflict banner**: `GET /api/sync` is built and tested; the small UI
  banner that consumes it is deferred.
- **Photo attach is two steps** (`POST /api/photos` → `PUT` the ref onto the
  record); a failure between them could orphan an uploaded blob.
- **Role change doesn't revoke a live session** until the cookie TTL expires or
  the user re-logs in (stateless sessions).
- **Cold-start test flake**: the very first `npm test` in a fresh shell can hit a
  transient "socket hang up"; it's green on retry.
