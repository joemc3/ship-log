# Ship's Log — self-hosting walkthrough

Step-by-step for running Ship's Log for your own boat, written to assume **nothing**.
The app is built and tested; this is the operator work only you can do — your repo,
your credential, your server.

> **Just want to look first?** You need none of this to try it. On any machine:
> `npm install && npm run build:ui && npm start`, then open <http://localhost:8080>
> — it runs in **demo mode** over a sample boat, no setup, no login.

---

## How the pieces fit (read this first)

Ship's Log is **two separate git repositories**. Keeping them straight is the thing
that makes everything else click:

| | What it is | Public? | Who writes to it |
|---|---|---|---|
| **The app repo** (`ship-log`) | the application **code** — generic, no boat data | public is fine | you, only to update the app (`git pull`) |
| **Your data repo** (e.g. `valkyrie-log`) | **your boat's data** — `boat.yaml`, trips, maintenance, photos | **private** | the running app **and** Claude Cowork, over git |

**Everything syncs through your private data repo. The public app repo is never in
the sync loop — your boat data never goes there.**

```
   app repo (public, CODE only)        your data repo (PRIVATE, your boat's DATA)
        │  clone / pull                        ▲   ▲
        ▼  (install + update only)       clone │   │ push
   ┌────────────────┐                          │   │
   │ the running app │── clone · pull · push ───┘   │
   │  (your server)  │                              │
   └────────────────┘                              │
   ┌────────────────┐                              │
   │  Claude Cowork  │── clone · edit · push ───────┘
   │ (your laptop)   │
   └────────────────┘
```

So the setup is always: **(1)** get the app running, pointed at **(2)** a private
data repo you create. Cowork later clones that same private data repo to help you
finish entries. That's the whole model.

> **Do I fork the app repo?** No need. To *run* it you only **clone** it. Fork only
> if you want your own copy of the *code* to modify. (You, as the repo's owner,
> obviously skip that.) The repo everyone **must create** is the **data** repo.

## What you'll need

- A machine to run the app on (your laptop to start, or a server/VPS). It needs
  **Docker** (recommended) or **Node 20+**.
- A **GitHub account** for the private data repo (`gh` CLI or the web UI).
- For a real (non-localhost) deployment: a **domain/subdomain** and a way to serve it
  over **HTTPS** — any reverse proxy (Caddy, nginx, Traefik, Cloudflare Tunnel), or
  the included **Pangolin** tunnel. HTTPS is required because the login cookie is
  `Secure`.

---

# Part 1 — Create your private data repo (everyone does this)

This is the step that holds your data and that both the app and Cowork sync through.
You're creating a **brand-new, private** GitHub repo and seeding it from the
`data-template/` folder that lives inside the app repo.

```bash
# 0. get the app repo (so you have data-template/ to copy from)
git clone https://github.com/joemc3/ship-log.git
#    -> this folder (e.g. ~/ship-log) is "the app repo" below.

# 1. create a NEW, EMPTY, PRIVATE repo on GitHub for your boat's data:
gh repo create valkyrie-log --private        # use your own name; --private matters
#    (or make it in the GitHub web UI: New repository -> Private -> Create)

# 2. clone that empty data repo somewhere SEPARATE from the app repo:
cd ~                                          # NOT inside ~/ship-log
git clone https://github.com/joemc3/valkyrie-log.git
cd valkyrie-log

# 3. copy the TEMPLATE out of the app repo into it (trailing "/." copies contents):
cp -R ~/ship-log/data-template/. .
#    you now have: boat.yaml, empty trips/ maintenance/ ... AND the Cowork docs
#    (AGENTS.md, SCHEMA.md, .claude/skills/complete-trip/) that came with the template.

# 4. make it yours — edit boat.yaml (name, make, model, year, hailingPort, specs,
#    and the welcome block guests see: rules / whatToExpect / whatToBring / safety):
$EDITOR boat.yaml

# 5. push it up to GitHub:
git add -A
git commit -m "Seed Valkyrie data from data-template"
git push
```

Your private data repo now exists on GitHub, with the Cowork tooling already inside
it. You'll fill in trips/maintenance/etc. **through the web app** once it's running,
or via Cowork (Part 5). Note its clone URL — you'll give it to the app as
`DATA_REPO_URL`:
- **SSH:** `git@github.com:joemc3/valkyrie-log.git` (pair with a deploy key, Part 2A)
- **HTTPS:** `https://github.com/joemc3/valkyrie-log.git` (pair with a token, Part 2B)

# Part 2 — Give the app a credential for that repo (everyone does this)

The running app needs read **and write** access to your one private data repo (to
clone, pull, and push). Pick **one** mode.

**A) SSH deploy key (recommended):**
```bash
cd ~/ship-log
ssh-keygen -t ed25519 -f ./deploy_key -N ''   # makes deploy_key (private) + deploy_key.pub
```
On GitHub: **valkyrie-log → Settings → Deploy keys → Add deploy key** → paste
`deploy_key.pub` → **check "Allow write access"** → Add. Use the **SSH**
`DATA_REPO_URL`.

**B) Fine-grained PAT (simplest with plain Docker):** create a token scoped to *only*
`valkyrie-log` with **Contents: read and write**. Use the **HTTPS** `DATA_REPO_URL`
and supply the token as `DATA_REPO_TOKEN`. (No file to mount — handy for Option A
below.)

---

# Part 3 — Run the app (choose ONE)

All options need the same inputs from Parts 1–2: `DATA_REPO_URL`, a credential, a
`SESSION_SECRET` (signs login cookies), and `OWNER_USERNAME`/`OWNER_PASSWORD` (your
first account). On first boot the app clones your data repo, bootstraps the owner,
and starts syncing.

## Option A — Docker behind your own reverse proxy (the common case)

The base `docker-compose.yml` publishes the app on host port **8080**; you put any
HTTPS reverse proxy in front. Easiest with a PAT (Part 2B).

1. In the app repo, create a `.env` next to the compose file:
   ```bash
   SESSION_SECRET=$(openssl rand -hex 32)      # or paste a fixed value; keep it stable + secret
   OWNER_USERNAME=joe
   OWNER_PASSWORD=choose-a-strong-password
   DATA_REPO_URL=https://github.com/joemc3/valkyrie-log.git
   DATA_REPO_TOKEN=github_pat_xxx              # the fine-grained PAT from Part 2B
   COOKIE_SECURE=true                          # you ARE serving via HTTPS (see step 3)
   # PULL_INTERVAL=300                          # optional; sync every N seconds (default 300)
   ```
   (Using an SSH key instead? Mount it and set `DATA_SSH_KEY_PATH` to the mounted
   path via a small compose override — the PAT path avoids that.)
2. Start it:
   ```bash
   docker compose up -d --build       # serves on http://<host>:8080
   docker compose logs -f shiplog     # watch for "Bootstrapped owner" + "Sync scheduler running"
   ```
3. **Put HTTPS in front.** Point your reverse proxy's hostname at `http://<host>:8080`.
   For example, Caddy is two lines:
   ```
   boat.yourdomain.com {
       reverse_proxy localhost:8080
   }
   ```
   (nginx/Traefik/Cloudflare Tunnel work the same — terminate TLS, proxy to `:8080`.)
   Then point that hostname's DNS at your server. Keep `COOKIE_SECURE=true`.

> If you genuinely must run plain HTTP (e.g. a LAN-only box with no TLS), set
> `COOKIE_SECURE=false` — but don't expose that to the internet.

## Option B — Docker behind a Pangolin tunnel, no exposed ports (the reference deployment)

This is the locked-down shape: **no host ports are published at all**; the only
ingress is your existing Pangolin/Gerbil tunnel. Use this if you already run the
Pangolin stack (the way the DA-RAG deployment does). It layers
`docker-compose.vps.yml` over the base.

**Prereqs:** your VPS already runs Docker + the Pangolin/Gerbil/Traefik stack, and
that stack's docker network already exists.

1. **Find your tunnel's docker network.** The override expects an **external** network
   literally named `pangolin`. Confirm yours:
   ```bash
   docker network ls                        # find the one your Pangolin/Traefik stack uses
   docker network inspect <that-network>    # note its Subnet, e.g. 172.18.0.0/16
   ```
   If it isn't named `pangolin`, edit `docker-compose.vps.yml` and change the network
   name in **both** the `services.shiplog.networks:` block and the top-level
   `networks:` block to match.
2. **Pin a free IP in that subnet.** The override pins `172.18.0.22` as a placeholder.
   Set it to a free, high address inside *your* subnet (outside Gerbil's DHCP range):
   ```yaml
   # docker-compose.vps.yml
   services:
     shiplog:
       networks:
         pangolin:
           ipv4_address: 172.18.0.22    # ← your free static IP
   ```
   **Remember this IP — it's what Pangolin will target.**
3. **Create the secrets** the override reads (in `~/ship-log/secrets/`):
   ```bash
   cd ~/ship-log && mkdir -p secrets
   openssl rand -hex 32            > secrets/session_secret    # SESSION_SECRET
   printf 'a-strong-password'      > secrets/owner_password     # OWNER_PASSWORD
   cp ./deploy_key                   secrets/data_deploy_key     # SSH mode (Part 2A): the PRIVATE key
   chmod 600 secrets/*
   ```
4. **Set the non-secret env** in `~/ship-log/.env`:
   ```bash
   OWNER_USERNAME=joe
   DATA_REPO_URL=git@github.com:joemc3/valkyrie-log.git    # SSH form (matches the deploy key)
   DATA_DIR=/app/data
   COOKIE_SECURE=true
   ```
   (`SESSION_SECRET` + `OWNER_PASSWORD` come from the secret files; don't put them
   here.)
5. **Bring it up:**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.vps.yml config   # sanity-check the merge
   docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
   docker compose logs -f shiplog
   ```
6. **Create the Pangolin resource** pointing at the container — same as your other
   tunneled services, using these values:

   | Pangolin setting | Value | Source |
   |---|---|---|
   | Public hostname | e.g. `boat.yourdomain.com` | you choose; point its DNS at Pangolin |
   | Target host | `172.18.0.22` (your pinned IP) | Step 2 (or the service name `shiplog` if your setup uses Docker DNS) |
   | Target port | `8080` | the app's internal HTTP port |
   | Target scheme | `http` (not https) | the app does plain HTTP; Pangolin/Traefik terminates TLS |
   | SSO / auth | **off** | the app gates itself |

> **About the ports.** The app only ever listens on **8080, plain HTTP, inside the
> Docker network** — it never uses port 80 and never does TLS itself. Your
> Pangolin/Traefik front end owns public `:443`/`:80` + the certificate and forwards
> to `8080`. That's why this option publishes **no** host ports.

## Option C — Without Docker (advanced)

```bash
cd ~/ship-log
npm ci
npm run build:ui                              # builds the SPA into dist/ui
DATA_REPO_URL=git@github.com:joemc3/valkyrie-log.git \
DATA_SSH_KEY_PATH=/home/you/.ssh/deploy_key \
SESSION_SECRET=... OWNER_USERNAME=joe OWNER_PASSWORD=... \
COOKIE_SECURE=true PORT=8080 \
  npm start
```
Run it under a process manager (systemd, pm2) and put an HTTPS reverse proxy in front
of `:8080`, exactly like Option A step 3. `git` must be installed (the app shells out
to it).

---

# Part 4 — First login & backup (everyone)

**Log in.** Open your HTTPS URL, sign in with `OWNER_USERNAME` + the password you set.
Then: **Account** → change the bootstrap password; **Admin** → add your crew/owner
users (crew see everything except costs).

**Back up the users store.** `users.json` (accounts + hashed passwords) lives in the
`shiplog-users` Docker volume (or `./var/` without Docker). It's *deployment state* —
never in git, and the one thing your data repo can't regenerate. Snapshot it:
```bash
docker run --rm -v ship-log_shiplog-users:/v -v "$PWD":/out alpine \
  cp /v/users.json /out/users.backup.json     # volume name = <compose-project>_shiplog-users
```

# Part 5 — Use Claude Cowork on your data repo

This closes the loop with Part 1 — Cowork works on a **local clone of your private
data repo**, never on the app.

```bash
git clone git@github.com:joemc3/valkyrie-log.git   # the SAME private repo from Part 1
cd valkyrie-log                                     # AGENTS.md/SCHEMA.md/the skill are already here
```
1. Install/enable Claude Cowork and open it in this `valkyrie-log` clone.
2. Drop in a half-written trip + photos (see `data-template/examples/half-written-trip/`
   for the shape) and run the **complete-trip** skill: it reads the trip + photos,
   researches against the web and your own `manuals/`, writes the narrative, opens the
   linked maintenance item, and **pushes** to GitHub.
3. The running app pulls that commit within `PULL_INTERVAL` (default 5 min) and the
   new entry appears in the web app. Done.

---

## Quick reference

| Thing | Value |
|---|---|
| Docker image | `ship-log:latest` |
| Compose service / network alias | `shiplog` |
| Container name | `<project>-shiplog-1` (project = the compose dir, e.g. `ship-log`) |
| App port (internal HTTP) | `8080` — base compose publishes it; the VPS override publishes nothing |
| Pangolin target (Option B) | `http://<pinned-IP>:8080` (default `172.18.0.22:8080`) |
| External network (Option B) | `pangolin` (must already exist; rename in `docker-compose.vps.yml` if yours differs) |
| Data volume | `shiplog-data` → `/app/data` (the data-repo clone) |
| Users volume (back up) | `shiplog-users` → `/app/var` (`users.json`) |
| Required env | `DATA_REPO_URL`, a credential (`DATA_SSH_KEY_PATH` or `DATA_REPO_TOKEN`), `SESSION_SECRET`, `OWNER_USERNAME`, `OWNER_PASSWORD` |

## By-design notes

- **Demo mode** (no `DATA_REPO_URL`/`DATA_DIR`) serves the fictional Valkyrie data
  *including* sample costs (the demo viewer is owner-equivalent). Don't point a public
  demo at a real, cost-bearing dataset.
- Cost data is owner-only and redacted **server-side** — it never reaches a crew/guest
  browser. The **app** enforces this, which is why Pangolin (Option B) runs with SSO
  **off**: the app is its own gate.
- `docker build` needs Docker Hub access for the base images — build where there's
  egress (your server, or any machine).

## Known non-blocking follow-ups (optional polish)

- A small in-app banner for the rare git **sync conflict** (the `GET /api/sync` API is
  built; the UI banner is deferred).
- Attaching a photo is two requests (upload, then save the record); a failure between
  them could leave an orphaned image file.
- Changing a user's role doesn't end their current session until it expires or they
  log in again.
