# Deploying Kinwarden

Kinwarden is one long-running Node process: the agent, the sandbox world, the timers and the live activity stream (server-sent events) all live in memory, with the world and the hash-chained log saved to a data folder. It needs a small server, not serverless functions.

## Deployment status

The public demo runs at https://kinwarden.duckdns.org with `deploy/demo.env` (Replay, read-only NEAR, no keys), on a 2 vCPU / 4 GB VM. Local development runs at `http://localhost:3000`. The examples below describe how to deploy your own instance; replace example hostnames with a domain you control. Passkeys are scoped to the hostname where they were registered.

## Server requirements

- **Region:** choose a server close to the intended users.
- **Size:** 1 vCPU, 1–2 GB RAM and 10 GB disk are enough. The model runs at NEAR AI Cloud (or DeepSeek/OpenAI), not on the server.
- **Domain:** any domain with an A record pointing at the server. HTTPS is required: passkeys and installing the app (PWA) only work on HTTPS.
- **Outbound access** to `cloud-api.near.ai` (or `api.deepseek.com`, `api.openai.com`), a NEAR RPC such as `near-testnet.drpc.org`, and, for Conflux anchors, `evmtestnet.confluxrpc.com`.

## Run it (Docker)

```bash
git clone https://github.com/JahanzaibMohsin9/kinwarden && cd kinwarden
cp .env.local.example .env.production     # fill in DEEPSEEK_API_KEY, OPENAI_API_KEY, and for on-chain anchors
                                          # ANCHOR_CHAIN, ANCHOR_PRIVATE_KEY, ANCHOR_CONTRACT (copy from your .env.local)
echo "KINWARDEN_DOMAIN=kinwarden.example.org" > .env  # your domain, read by docker compose
docker compose up -d --build
```

Caddy gets and renews the certificate on its own, and passes the event stream through without buffering (`deploy/Caddyfile`). The world, log, recordings and passkeys are kept in the `kinwarden-data` volume, so they survive restarts and rebuilds.

Update: `git pull && docker compose up -d --build`. Logs: `docker compose logs -f app`.

## Public demo: Replay, read-only NEAR, no keys

For a public URL, run the app with `deploy/demo.env` instead of `.env.production`. It holds no secrets:
no NEAR agent key, no model key and no anchor key. Visitors each get their own sandbox, starting in
Replay (the recorded live NEAR AI runs). The NEAR parts are read-only: the attack lab reads the agent
key's permissions from public testnet RPC with the agent's public key, and shows the bypass run that
was recorded on testnet with the real key; the rerun button is off.

```bash
echo "KINWARDEN_DOMAIN=<hostname>" > .env
docker compose -f docker-compose.yml -f deploy/compose.demo.yml up -d --build
```

After deploying, check from a fresh browser with no cookies: the landing page's testnet links open,
the hospital case plays in Replay, and the attack lab shows "read now" permissions and the testnet
run. `GET /api/state` must show `"near": null` and `"hasKey": false`, and `POST /api/near/bypass` must
answer 403.

## On a server that already runs other sites

If ports 80/443 are taken by your own reverse proxy, run only the app and point the proxy at it:

```bash
cp .env.local.example .env.production     # keys; ANCHOR_* for on-chain anchors
docker compose -f docker-compose.shared.yml up -d --build    # app on 127.0.0.1:3010 only
```

Then add a site to your proxy: `deploy/nginx-kinwarden.conf` for nginx (it switches off buffering for the event stream and allows 8 MB uploads), and get a certificate with `certbot --nginx -d <hostname>`. With Caddy it is one line: `<hostname> { reverse_proxy 127.0.0.1:3010 }`. With Traefik, give the `app` service the usual router labels instead of the port mapping.

If the proxy itself runs in Docker (for example another project's Caddy container), a container can't reach the host's 127.0.0.1. Join its network instead, with no port published: `PROXY_NETWORK=<its network> docker compose -f docker-compose.shared.yml -f deploy/compose.join-proxy.yml up -d --build`, and point the proxy at `kinwarden:3000`.

## No domain? Free hostnames

HTTPS needs a hostname, not a bare IP. Free options, best first:

1. **A subdomain of a domain you already have** for another project: add an A record `kinwarden.<your-domain>` → the server's IP. Costs nothing and is the most reliable.
2. **DuckDNS** (free, sign in with GitHub or Google): register `kinwarden` (or the first free name) at duckdns.org, point it at the server's IP, and use the hostname assigned to you. Let's Encrypt certificates work as usual.
3. **sslip.io** (no sign-up at all): `kinwarden.<ip-with-dashes>.sslip.io`, e.g. `kinwarden.51-15-20-30.sslip.io`, resolves to that IP by itself. Let's Encrypt works for it too. The name is uglier but there is nothing to register.

Check DNS, HTTPS and event streaming from your intended users' networks before sharing a deployment.

## Without Docker

```bash
npm ci && npm run build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && cp -r recordings .next/standalone/
KINWARDEN_DATA_DIR=/var/lib/kinwarden PORT=3000 node .next/standalone/server.js
```

Put it behind any HTTPS reverse proxy that doesn't buffer `text/event-stream` (for nginx: `proxy_buffering off;` on `/api/stream`). Keep it running with systemd or pm2.

## After deploying

1. Open `https://<domain>/director`, load each scenario in **Replay** and play it through: this needs no API key and shows the stream works through the proxy.
2. Switch to **Live** and run one scenario: checks the keys and outbound access.
3. Register a passkey on a phone and approve a payment with it (needs HTTPS and the real domain).
4. Install the app from the browser menu on Android (Chrome) and iPhone (Safari, Share → Add to Home Screen); check it opens full-screen on `/app`.
5. Test the URL with a "website speed test from China" tool, and from Pakistan if possible.

## Private sandboxes

With `KINWARDEN_SESSIONS=per-visitor` (set on the live server) each visitor gets their own world: `src/proxy.ts` gives the first page they open a cookie, and every API call works on that visitor's world, stored under `/data/sessions/<id>/`. Requests without the cookie (scripts, curl) share one world. Idle worlds are removed after `KINWARDEN_SESSION_IDLE_HOURS` (default 6) and the oldest beyond `KINWARDEN_MAX_SESSIONS` (default 80). `KINWARDEN_DEFAULT_MODE=replay` makes new worlds start in Replay, so visitors cost no AI credits until someone switches to Live. Anchors from every world go through one queue, since one wallet signs them all.

## Known limits of the public demo

- **Costs.** Live mode and reading uploaded photos call paid APIs. Keep Replay as the default for the public link, keep provider credit low, and watch usage during judging. The Director page is not protected, by design for the judges.
- **Sandbox only.** No real money, banks or institutions are involved; every institution, account and person in the scenarios is fictional, and the rates are sandbox rates.
