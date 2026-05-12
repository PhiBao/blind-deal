# BlindDeal — Deployment Guide

**Architecture**

```
┌─────────────────────────┐     ┌────────────────────────────┐
│   Vercel (serverless)   │     │   Render (background worker)│
│                         │     │                            │
│  blind-deal.vercel.app   │     │  blinddeal-bot.onrender.com │
│  ┌───────────────────┐  │     │  ┌──────────────────────┐  │
│  │ Frontend (Vite)   │  │     │  │ MCP Server :3001     │  │
│  │ → React + wagmi   │  │     │  │ → /mcp (JSON-RPC)   │  │
│  │ → Tailwind CSS    │  │     │  │ → /health            │  │
│  └───────────────────┘  │     │  ├──────────────────────┤  │
│  ┌───────────────────┐  │     │  │ Telegram Bot         │  │
│  │ API (serverless)  │  │     │  │ → @BlindDealBot      │  │
│  │ → POST /api/escrow/ │  │     │  │ → event polling 15s │  │
│  │   create          │  │     │  └──────────────────────┘  │
│  │   fund            │  │     └────────────────────────────┘
│  │   redeem          │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

---

## Part 1: Vercel — Frontend + Escrow API

### Prerequisites

- Vercel account connected to GitHub
- Project repo with `frontend/vercel.json`
- Environment variables configured in Vercel dashboard

### vercel.json (already exists)

```json
{
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "installCommand": "pnpm install",
  "devCommand": "npx vite --port $PORT",
  "framework": "vite",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Embedder-Policy", "value": "credentialless" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    }
  ],
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**Important:** `vercel.json` lives in the `frontend/` directory. When importing to Vercel, set the **Root Directory** to `frontend/`.

### Vercel API Routes (already exist)

| Route | File | Purpose |
|---|---|---|
| `POST /api/escrow/create` | `frontend/api/escrow/create.ts` | Create Privara escrow with FHE-encrypted owner + amount |
| `POST /api/escrow/fund` | `frontend/api/escrow/fund.ts` | Fund escrow via ConfUSDC |
| `POST /api/escrow/redeem` | `frontend/api/escrow/redeem.ts` | Redeem escrow to seller |

These are **Vercel serverless functions** (`@vercel/node` runtime). They run on-demand and scale to zero.

### One-Click Deploy

```bash
cd frontend
vercel --prod
```

Alternatively, connect the GitHub repo in Vercel dashboard:
1. **Import Repository** → select `blinddeal`
2. **Root Directory** → `frontend/`
3. **Framework Preset** → Vite
4. **Build Command** → `vite build`
5. **Output Directory** → `dist`

### Vercel Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `PRIVATE_KEY` | `0x...` | Hot wallet for escrow txs (Arb Sepolia) |
| `ARBITRUM_SEPOLIA_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | Or private RPC |
| `VITE_SEPOLIA_RPC_URL` | `https://ethereum-sepolia.publicnode.com` | Exposed to frontend |
| `VITE_ARBITRUM_SEPOLIA_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | Exposed to frontend |
| `VITE_TELEGRAM_BOT_USERNAME` | `BlindDealBot` | Bot username for deep-links |
| `VITE_MCP_ENDPOINT` | `https://blinddeal-bot.onrender.com/mcp` | → Render MCP endpoint |

### How the API proxy works

**In development:** Vite proxies `/api/*` → `http://localhost:3002` (your local API server)

```ts
// vite.config.ts
server: {
  proxy: { '/api': 'http://localhost:3002' },
}
```

**In production (Vercel):** The `vercel.json` rewrite sends `/api/*` to the serverless functions directly. No proxy needed.

### Common Vercel Issues

| Issue | Fix |
|---|---|
| API returns 404 | Check `vercel.json` rewrites — `/api/(.*)` must route to `/api/$1` |
| `@reineira-os/sdk` not found | Ensure frontend `package.json` includes it; pnpm workspace hoists correctly |
| CORS errors | API routes set `Access-Control-Allow-Origin: *` already |
| Serverless timeout (10s) | Escrow txs take 2-5s on Arbitrum Sepolia — within limits |
| `.env` variables not loading | Set them in Vercel dashboard, not in repo |

---

## Part 2: Render — MCP Server + Telegram Bot

### Architecture

The MCP Server and Telegram Bot run as a single **Background Worker** on Render. The `start-bot.ts` script spawns both as child processes with auto-restart on crash.

```
start-bot.ts
  ├── MCP Server (:3001) ← receives POST /mcp from AI agents
  └── Telegram Bot       ← long-polling contract events every 15s
```

### render.yaml (already exists)

```yaml
services:
  - type: worker
    name: blinddeal-bot
    env: node
    region: oregon
    plan: free
    branch: main
    buildCommand: pnpm install --frozen-lockfile
    startCommand: npx tsx start-bot.ts all
    envVars:
      - key: NODE_ENV
        value: production
      - key: TELEGRAM_BOT_TOKEN
        sync: false        # Set in Render dashboard
      - key: ARBITRUM_SEPOLIA_RPC_URL
        sync: false
      - key: SEPOLIA_RPC_URL
        sync: false
      - key: PRIVATE_KEY
        sync: false
      - key: FRONTEND_URL
        value: https://blind-deal.vercel.app
      - key: MCP_PORT
        value: "3001"
```

### One-Click Deploy on Render

**Option A — Blueprint (render.yaml):**
```bash
# Push to GitHub, then:
https://render.com/deploy?repo=https://github.com/YOUR_USERNAME/blinddeal
```

**Option B — Manual:**
1. Render Dashboard → **New Background Worker**
2. Connect GitHub repo `blinddeal`
3. **Root Directory** → `/` (whole repo)
4. **Build Command** → `pnpm install --frozen-lockfile`
5. **Start Command** → `npx tsx start-bot.ts all`
6. **Plan** → Free
7. Add environment variables (see below)
8. **Deploy**

### Render Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | (secret) | From @BotFather |
| `ARBITRUM_SEPOLIA_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | Or private RPC |
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia.publicnode.com` | |
| `PRIVATE_KEY` | (optional) | Only needed if bot submits txs |
| `FRONTEND_URL` | `https://blind-deal.vercel.app` | For deep-links |
| `VITE_TELEGRAM_BOT_USERNAME` | `BlindDealBot` | |
| `MCP_PORT` | `3001` | |

### Render Health Checks

The MCP Server exposes `/health` for monitoring:

```bash
curl https://blinddeal-bot.onrender.com/health
# → {"status":"ok","name":"BlindDeal MCP Server","version":"1.0.0"}
```

### Keeping Render Free Tier Alive

Render free workers spin down after 15 min of inactivity. To keep the bot + MCP alive:

1. **Set up a cron job** (e.g., GitHub Actions, cron-job.org, UptimeRobot) to ping `/health` every 10 min
2. **Render's own health check** — set the health check path to `/health` in the dashboard

GitHub Action example (`.github/workflows/keepalive.yml`):

```yaml
on:
  schedule: [{ cron: "*/10 * * * *" }]
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -s https://blinddeal-bot.onrender.com/health
```

---

## Part 3: End-to-End Configuration

### Wiring Everything Together

```
Frontend (Vercel)
  → API calls to /api/escrow/* (serverless, same domain)
  → MCP calls to VITE_MCP_ENDPOINT (Render URL)
  → Telegram deep-links back to FRONTEND_URL (Vercel URL)

Telegram Bot (Render)
  → Polls Arbitrum Sepolia chain for events
  → Sends notifications with deep-links to FRONTEND_URL
  → Subscriptions stored in .subscriptions.json (ephemeral — resets on deploy)

MCP Server (Render)
  → Reads contract state via viem clients
  → Accepts JSON-RPC from AI agents
  → Health check at /health
```

### Step-by-Step Demo Setup

```bash
# 1. Deploy frontend + API to Vercel
cd frontend
vercel --prod

# 2. Deploy bot to Render
#    - Import repo as Background Worker
#    - Set start command: npx tsx start-bot.ts all
#    - Add env vars
#    - Deploy

# 3. Set VITE_MCP_ENDPOINT to your Render URL
#    In Vercel dashboard: VITE_MCP_ENDPOINT=https://blinddeal-bot.onrender.com/mcp

# 4. Re-deploy frontend on Vercel (so it picks up the env change)
vercel --prod

# 5. Verify:
#    - Open https://blind-deal.vercel.app
#    - Check MCP health: https://blinddeal-bot.onrender.com/health
#    - Try /list in Telegram bot
```

### Environment Checklist

| Where | Variable | Required |
|---|---|---|
| Vercel | `PRIVATE_KEY` | ✅ For escrow API |
| Vercel | `ARBITRUM_SEPOLIA_RPC_URL` | ✅ |
| Vercel | `VITE_SEPOLIA_RPC_URL` | ✅ |
| Vercel | `VITE_ARBITRUM_SEPOLIA_RPC_URL` | ✅ |
| Vercel | `VITE_TELEGRAM_BOT_USERNAME` | ✅ |
| Vercel | `VITE_MCP_ENDPOINT` | ✅ |
| Render | `TELEGRAM_BOT_TOKEN` | ✅ |
| Render | `ARBITRUM_SEPOLIA_RPC_URL` | ✅ |
| Render | `SEPOLIA_RPC_URL` | ✅ |
| Render | `FRONTEND_URL` | ✅ |
| Render | `PRIVATE_KEY` | Optional |

---

## Part 4: Local Development

### Quick Start (All 4 Services)

```bash
pnpm dev:all
```

This spawns:
| Service | Port | File |
|---|---|---|
| Frontend | `:3000` | Vite dev server |
| Escrow API | `:3002` | `frontend/dev-api.mjs` |
| MCP Server | `:3001` | `mcp-server/index.ts` |
| Telegram Bot | — | `telegram-bot/index.ts` |

Output with color-coded prefixes:
```
[dev-all   ] 12:34:56 All services starting — press Ctrl+C to stop all
[frontend  ] 12:34:57 VITE v8.0.0 ready in 214ms → http://localhost:3000
[api       ] 12:34:59 API dev server on http://localhost:3002
[mcp       ] 12:35:00 BlindDeal MCP Server on http://0.0.0.0:3001/mcp
[telegram  ] 12:35:01 BlindDeal Telegram bot started
```

Each service auto-restarts on crash. `Ctrl+C` stops everything.

### Individual Services

```bash
pnpm dev:fe         # Frontend only (:3000)
pnpm dev:api        # API only (:3002)
pnpm mcp            # MCP Server only (:3001)
pnpm start:bot telegram  # Telegram bot only
pnpm start:bot      # MCP + Telegram (for production-like testing)
```

---

## Part 5: Troubleshooting

### "MCP endpoint not reachable" in frontend

**Frontend** → MCP calls go to `VITE_MCP_ENDPOINT`. In dev, this is `http://localhost:3001/mcp`. On Vercel, it must be the Render URL.

Check:
- `VITE_MCP_ENDPOINT` is set correctly in Vercel dashboard
- Render service is running (`/health` returns 200)
- CORS: Render doesn't need CORS headers since it's a server-to-server call from the browser

### "Telegram bot not responding"

- Check `TELEGRAM_BOT_TOKEN` in Render env vars
- Check bot was started: send `/start` to the bot
- Check Render logs for errors
- Free tier spins down after inactivity — use keepalive cron

### "API returns 500 — PRIVATE_KEY not configured"

- This env var must be set in Vercel dashboard (not in `.env` in repo)
- Use a dedicated hot wallet with testnet ETH for gas

### "Escrow tx pending forever"

- Arbitrum Sepolia has ~250ms block time, so txs should confirm in 2-5s
- Check RPC URL — public RPC may be rate-limited
- Ensure wallet has testnet ETH

### "CoFHE worker not loading"

- Cross-Origin-Embedder-Policy and Cross-Origin-Opener-Policy headers must be set
- Already configured in `vercel.json`
- In dev mode, the `cofhe-worker-serve` Vite plugin handles this

### "Subscriptions lost after Render deploy"

- Telegram subscriptions are stored in `.subscriptions.json` on disk
- Render's ephemeral filesystem means this resets on every deploy
- **Workaround:** Use a persistent volume or external database. For demo purposes, users just re-subscribe after deploy.
