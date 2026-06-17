# Ship's Log — self-hosting walkthrough

This is the step-by-step for standing up Ship's Log on your own VPS, written to
assume **nothing**. The app is built and tested; everything here is the operator
work only you can do (your accounts, your secrets, your server).

> **Just want to look first?** You don't need any of this to try it. On any machine:
> `npm install && npm run build:ui && npm start`, then open <http://localhost:8080>
> — it runs in demo mode over a sample boat with no setup.

---

## How the pieces fit (read this first)

Ship's Log is **two git repositories**, and keeping them straight is the thing that
makes everything else click:

| | What it is | Where it lives | Who edits it |
|---|---|---|---|
| **The app repo** (`sailing` / *ship-log*) | the generic application code — no boat data | you clone it onto your VPS and run it in Docker | you (for updates), via `git pull` |
| **Your data repo** (e.g. `valkyrie-log`) | *your boat's* data — `boat.yaml`, trips, maintenance, photos… | a **separate, private** GitHub repo | the running app + Claude Cowork, over git |

**How they connect:** the app runs in a Docker container on your VPS. On first boot
it **clones your private data repo** into a volume and serves it. When you edit
something in the web app, it commits and pushes back to that data repo. That's it.

You create your data repo by copying the **`data-template/`** folder — which lives
*inside the app repo you just cloned* — into a new, empty private repo. The template
is the empty skeleton (an empty `boat.yaml`, empty collection folders, and the
Cowork docs); `demo/` is the *filled-in* sample (Valkyrie) and is **not** your
starting point.

```
your VPS
├── ~/sailing/                 ← the APP repo you cloned (code + data-template/)
│   ├── data-template/         ← copy THIS to seed your data repo
│   ├── docker-compose.yml
│   └── docker-compose.vps.yml
│
└── (Docker)
    └── container "shiplog"  ──clones──▶  github.com/you/valkyrie-log  (your DATA repo)
            │
            └── reachable only via your Pangolin tunnel (no open ports)
```

## What you'll need before you start

- A **VPS** that already runs Docker **and your Pangolin/Gerbil tunnel stack** (the
  same setup your other tunneled services use). This guide does **not** install
  Pangolin — it assumes it's already there, the way your DA-RAG deployment is.
- A **GitHub account** (for the private data repo) and the `gh` CLI or the web UI.
- A **domain/subdomain** you can point at Pangolin (e.g. `boat.yourdomain.com`).

---

## Step 1 — Put the app on your VPS

```bash
git clone https://github.com/joemc3/sailing.git
cd sailing
# from here on, this directory (e.g. ~/sailing) is referred to as the app repo.
```

## Step 2 — Create your boat's private data repo

This is the part that wasn't clear before. You're **copying `data-template/` out of
the app repo** (Step 1) **into a brand-new, empty private repo**.

```bash
# 1. make a new EMPTY private repo on GitHub (web UI, or:)
gh repo create valkyrie-log --private        # use your own name; --private is important

# 2. clone the empty repo somewhere SEPARATE from the app repo
cd ~                                          # not inside ~/sailing
git clone https://github.com/joemc3/valkyrie-log.git
cd valkyrie-log

# 3. copy the TEMPLATE (from the app repo) into it — note the trailing "/." copies contents
cp -R ~/sailing/data-template/. .

# 4. make it yours: edit boat.yaml (name, make, model, year, hailingPort, specs,
#    and the welcome block your guests see — rules / whatToExpect / whatToBring / safety)
$EDITOR boat.yaml

# 5. commit + push
git add -A
git commit -m "Seed Valkyrie data from data-template"
git push
```

You now have an (almost empty) data repo. It already includes `AGENTS.md`,
`SCHEMA.md`, and the `complete-trip` Cowork skill (they came from the template), so
Cowork is ready the moment it clones this repo. You'll fill in trips, maintenance,
etc. **through the web app** once it's running — or copy a few records out of the app
repo's `demo/` folders as examples.

> Note the clone URL from Step 2 — you'll set it as `DATA_REPO_URL` later. Use the
> **SSH** form (`git@github.com:joemc3/valkyrie-log.git`) if you pick the SSH key in
> Step 3, or the **HTTPS** form if you pick a token.

## Step 3 — Give the app a key to your data repo

The app needs read **and write** access to that one private repo (to clone, pull,
and push). Pick **one** credential mode.

**A) SSH deploy key (recommended — scoped to the one repo, no expiry):**
```bash
cd ~/sailing                                  # back in the app repo
ssh-keygen -t ed25519 -f ./deploy_key -N ''   # creates deploy_key (private) + deploy_key.pub
```
Then on GitHub: **valkyrie-log → Settings → Deploy keys → Add deploy key** → paste
the contents of `deploy_key.pub` → **check "Allow write access"** → Add.
Use the **SSH** `DATA_REPO_URL` (`git@github.com:joemc3/valkyrie-log.git`).

**B) Fine-grained PAT (alternative):** create a token scoped to *only* `valkyrie-log`
with **Contents: read and write**, use the **HTTPS** `DATA_REPO_URL`, and supply the
token as `DATA_REPO_TOKEN` (or the `data_deploy_key`/`_FILE` secret). Use this *or*
the key, not both.

## Step 4 — Create the secrets

The VPS compose file reads three Docker secrets from a `./secrets/` folder **next to
the compose files** (in `~/sailing`). Never commit these.

```bash
cd ~/sailing
mkdir -p secrets
openssl rand -hex 32              > secrets/session_secret    # signs login cookies
printf 'choose-a-strong-pass'    > secrets/owner_password     # your first-owner password
cp ./deploy_key                    secrets/data_deploy_key     # SSH mode: the PRIVATE key
chmod 600 secrets/*
```
(Your owner *username* is plain config, set in Step 6 — only the password is a secret.)

## Step 5 — Put the container on your Pangolin network

This is the networking piece. The VPS override
(`docker-compose.vps.yml`) **does not publish any ports** — instead it joins the
container to the Docker network your Pangolin/Gerbil stack already runs on, and gives
it a fixed IP there so the tunnel always finds it. You need to get two values right:

**1. The network name.** The override expects an **external** network literally named
`pangolin`. Confirm what yours is actually called:
```bash
docker network ls            # find the network your Pangolin/Gerbil/Traefik stack uses
docker network inspect <that-network>   # note its "Subnet" (e.g. 172.18.0.0/16)
```
If your network is **not** named `pangolin`, edit the bottom of
`docker-compose.vps.yml` and change the network name to match yours (in both the
`services.shiplog.networks:` block and the top-level `networks:` block).

**2. A free static IP in that subnet.** The override pins `172.18.0.22` as a
**placeholder**. If your subnet is different, or `.22` is taken, change it:
```yaml
# docker-compose.vps.yml
services:
  shiplog:
    networks:
      pangolin:
        ipv4_address: 172.18.0.22   # ← set to a free, high address inside YOUR subnet
```
Pick something outside whatever DHCP range Gerbil hands out, the same way you'd pin
any other tunneled service. **Remember this IP — it's what Pangolin will target.**

> **About ports:** the app listens on **8080, plain HTTP, only inside the Docker
> network** — it never uses port 80 and never does TLS itself. Your Pangolin/Traefik
> front end is what owns the public `:443`/`:80` and the certificate; it forwards to
> the container's `8080`. That's why the VPS shape publishes **no** host ports.

## Step 6 — Set the non-secret config

Create a `.env` file next to the compose files (`~/sailing/.env`):
```bash
OWNER_USERNAME=joe                                  # your first-owner login name
DATA_REPO_URL=git@github.com:joemc3/valkyrie-log.git   # SSH form (matches Step 3A)
DATA_DIR=/app/data                                  # clone path inside the container (leave as-is)
COOKIE_SECURE=true                                  # you're behind TLS via Pangolin
# PULL_INTERVAL=300                                 # optional: sync every N seconds (default 300 = 5 min)
```
(`SESSION_SECRET` and `OWNER_PASSWORD` come from the secret files via the override —
don't put them here.)

## Step 7 — Bring it up

```bash
cd ~/sailing
# sanity-check the merged config (ports cleared, network external, IP pinned):
docker compose -f docker-compose.yml -f docker-compose.vps.yml config

# build + start, detached:
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build

# watch the boot — you want to see "Bootstrapped owner" + "Sync scheduler running":
docker compose logs -f shiplog
```
On first boot the app clones `valkyrie-log` into the `shiplog-data` volume,
bootstraps your owner account, and starts the sync scheduler. If a credential is
wrong it **boots read-only** with a warning (serving the demo data) rather than
crashing — fix the key/token and restart.

## Step 8 — Create the Pangolin tunnel resource

Now point your tunnel at the container. In Pangolin, create a resource the same way
you do for your other services, using these values:

| Pangolin setting | Value | Where it comes from |
|---|---|---|
| Public hostname / domain | e.g. `boat.yourdomain.com` | you choose it; point its DNS at your Pangolin server |
| Target host (internal) | `172.18.0.22` | the pinned IP from Step 5 (or the service name `shiplog` if your setup uses Docker DNS) |
| Target port | `8080` | the app's internal HTTP port |
| Target scheme | `http` (not https) | TLS is terminated by Pangolin/Traefik, not the app |
| Network | the same `pangolin` network the container joined | so Traefik can reach `172.18.0.22:8080` |
| SSO / auth | **off** | the app gates itself (its own login + roles) |

For reference, the running pieces are: **image** `ship-log:latest`, **compose
service** `shiplog`, **container** `<project>-shiplog-1` (project name = the
directory you ran compose in, e.g. `sailing-shiplog-1`), with the network alias
`shiplog`. The robust target is the **pinned IP `172.18.0.22:8080`** — that's the
whole reason the IP is pinned.

## Step 9 — First login

Open `https://boat.yourdomain.com` (through the tunnel). Log in with `OWNER_USERNAME`
and the password you set in `secrets/owner_password`. Then:
- **Account** → change that bootstrap password to something only you know.
- **Admin** → add your crew/owner accounts (crew see everything except costs).

## Step 10 — Back up the users store

`users.json` (your accounts + hashed passwords) lives in the **`shiplog-users`**
Docker volume — it's *deployment state*, never committed to git, and the one thing
your data repo can't regenerate. Back it up:
```bash
docker run --rm -v sailing_shiplog-users:/v -v "$PWD":/out alpine \
  cp /v/users.json /out/users.backup.json     # volume name = <project>_shiplog-users
```
(Or just re-bootstrap the owner and re-add users if you ever lose it.)

---

## Cowork — the "finish my half-written trip" workflow

Once the data repo exists, Claude Cowork can finish entries for you:
1. Install/enable Claude Cowork.
2. Clone `valkyrie-log` (it already ships `AGENTS.md`, `SCHEMA.md`, and
   `.claude/skills/complete-trip/SKILL.md` from the template).
3. Drop in a half-written trip + photos (see
   `data-template/examples/half-written-trip/` for the shape) and run the
   **complete-trip** skill: it reads the trip + photos, researches against the web and
   your own `manuals/`, writes the narrative, opens the linked maintenance item, and
   pushes.
4. The deployed app pulls the change within `PULL_INTERVAL` (default 5 min).

## Quick reference

| Thing | Value |
|---|---|
| Docker image | `ship-log:latest` |
| Compose service / network alias | `shiplog` |
| Container name | `<project>-shiplog-1` (project = compose dir, e.g. `sailing`) |
| App port (internal HTTP) | `8080` — no host ports published on the VPS |
| Pangolin target | `http://<pinned-IP>:8080` (default `172.18.0.22:8080`) |
| External network | `pangolin` (must already exist; rename in `docker-compose.vps.yml` if yours differs) |
| Data volume | `shiplog-data` → `/app/data` (the data-repo clone) |
| Users volume (back up) | `shiplog-users` → `/app/var` (`users.json`) |

## By-design notes

- **Demo mode** (no `DATA_REPO_URL`/`DATA_DIR`) serves the fictional Valkyrie data
  *including* sample costs (the demo viewer is owner-equivalent). Don't point a public
  demo at a real, cost-bearing dataset.
- `docker build` needs Docker Hub access for the base images — build on the VPS (or
  any machine with egress); it's the `--build` in Step 7.
- Cost data is owner-only and redacted **server-side**; it never reaches a crew/guest
  browser. The app, not the tunnel, enforces all of this — Pangolin runs **without
  SSO** on purpose.

## Known non-blocking follow-ups (optional polish)

- A small in-app banner for the rare git **sync conflict** (the `GET /api/sync` API
  is built; the UI banner is deferred).
- Attaching a photo is two requests (upload, then save the record); a failure between
  them could leave an orphaned image file.
- Changing a user's role doesn't end their current session until it expires or they
  log in again.
