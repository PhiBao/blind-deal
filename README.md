# BlindDeal

**Confidential P2P Price Negotiation on Fhenix**

> Two parties negotiate a price without ever revealing their numbers — unless they agree.

---

## Table of Contents

- [What is BlindDeal?](#what-is-blinddeal)
- [Why BlindDeal?](#why-blinddeal)
- [How It Works](#how-it-works)
- [Privacy Model](#privacy-model)
- [FHE Operations Deep Dive](#fhe-operations-deep-dive)
- [Escrow Settlement](#escrow-settlement)
- [Architecture](#architecture)
- [Live Demo](#live-demo)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Usage — Hardhat Tasks](#usage--hardhat-tasks)
- [Tests](#tests)
- [Roadmap](#roadmap)
- [Tech Stack](#tech-stack)

---

## What is BlindDeal?

BlindDeal is a **sealed-bid negotiation protocol** where:

1. A **buyer** submits their **maximum acceptable price** (encrypted with FHE)
2. A **seller** submits their **minimum acceptable price** (encrypted with FHE)
3. The smart contract computes — entirely on encrypted data — whether the prices overlap
4. **If they match**: the deal closes at the **midpoint price**, revealed only to both parties
5. **If they don't match**: **neither price is ever revealed** — zero information leakage
6. On match, **Privara conditional escrow** settles the deal trustlessly with FHE-encrypted USDC

This is fundamentally impossible on transparent blockchains. On Ethereum, submitting a price means the world sees it. On Fhenix with FHE, the contract computes on ciphertext without ever seeing the plaintext.

### The Core Insight

Traditional negotiation has an information asymmetry problem: whoever reveals their number first loses leverage. BlindDeal eliminates this by ensuring **simultaneous, encrypted submission** with **conditional disclosure** — prices are only revealed when there's a deal, and even then, only the fair midpoint.

---

## Why BlindDeal?

### The Problem

| Scenario | What happens on transparent chains |
|---|---|
| Salary negotiation | Employer sees your minimum, offers exactly that |
| OTC trade | Counterparty front-runs your limit price |
| Service pricing | Client sees your floor rate, negotiates you down to it |
| M&A / IP licensing | Seller sees buyer's ceiling, extracts maximum |

In every case, **revealing your price destroys your negotiating position**.

### Why FHE Solves This

Fhenix's Fully Homomorphic Encryption allows the smart contract to:

- **Compare** encrypted values (`buyerMax >= sellerMin?`) without decrypting them
- **Compute** on encrypted values (`(buyerMax + sellerMin) / 2`) without seeing either number
- **Conditionally reveal** results only when both parties benefit

This is not possible with commit-reveal schemes (they require eventual reveal), zero-knowledge proofs (complex setup, limited computation), or trusted third parties (counterparty risk).

### Why It Matters

| Criterion | BlindDeal |
|---|---|
| **Privacy Architecture** | Cannot exist without FHE — prices encrypted end-to-end, conditional disclosure, zero-leakage on no-match |
| **Innovation & Originality** | First sealed-bid negotiation protocol on FHE — uses 6 FHE operations for encrypted price discovery |
| **User Experience** | Two-party side-by-side flow, real-time status updates, one-click escrow settlement |
| **Technical Execution** | Smart contracts + React frontend + Privara escrow + CoFHE SDK — full stack deployed on Arbitrum Sepolia |
| **Market Potential** | OTC trading, salary negotiation, service pricing, M&A — any bilateral price discovery with information asymmetry |

---

## How It Works

### Deal Lifecycle

```
┌─────────────┐
│  createDeal  │  Buyer initiates, names the seller
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────┐
│           DealState: Open                │
│                                          │
│  submitBuyerPrice(encrypted max)         │
│  submitSellerPrice(encrypted min)        │
│  (either order, both required)           │
│                                          │
│  cancelDeal() — either party can exit    │
└──────────────┬───────────────────────────┘
               │  Both prices submitted
               ▼
┌──────────────────────────────────────────┐
│        _resolve() — FHE Engine           │
│                                          │
│  1. FHE.gte(buyerMax, sellerMin)         │
│     → encrypted boolean: match?          │
│                                          │
│  2. FHE.add(buyerMax, sellerMin)         │
│     FHE.div(sum, 2)                      │
│     → encrypted midpoint price           │
│                                          │
│  3. FHE.select(match, midpoint, 0)       │
│     → encrypted deal price               │
│                                          │
│  4. ITaskManager.createDecryptTask(isMatch)
│     FHE.allowGlobal(isMatch)             │
│     → enables client-side decryptForView │
└──────────────┬───────────────────────────┘
               │  Client decrypts via CoFHE SDK
               ▼
┌──────────────────────────────────────────┐
│        clientFinalizeDeal()              │
│                                          │
│  ✅ Match → DealState: Matched           │
│     Both parties unseal the midpoint     │
│     → Escrow settlement begins           │
│                                          │
│  ❌ No Match → DealState: NoMatch        │
│     Neither price is ever revealed       │
│     Privacy fully preserved              │
└──────────────────────────────────────────┘
               │  On match
               ▼
┌──────────────────────────────────────────┐
│     Privara Escrow Settlement            │
│                                          │
│  1. Create escrow (amount = midpoint)    │
│  2. Link to BlindDealResolver condition  │
│  3. Fund escrow (FHE-encrypted USDC)     │
│  4. Seller redeems when condition met    │
└──────────────────────────────────────────┘
```

### Step-by-Step Example

**Buyer max = 1000, Seller min = 800**

| Step | Action | On-Chain State | Who Sees What |
|------|--------|----------------|---------------|
| 1 | Buyer calls `createDeal(seller, "Logo design")` | Deal created, state = Open | Both see deal exists |
| 2 | Buyer encrypts `1000`, calls `submitBuyerPrice(enc(1000))` | `buyerMax` = ciphertext | Nobody sees 1000 |
| 3 | Seller encrypts `800`, calls `submitSellerPrice(enc(800))` | `sellerMin` = ciphertext | Nobody sees 800 |
| 4 | Contract auto-resolves | `gte(enc(1000), enc(800))` → `enc(true)` | Contract can't see the result |
| 5 | Midpoint computed | `(enc(1000) + enc(800)) / 2` → `enc(900)` | Still all encrypted |
| 6 | Frontend decrypts `isMatch` via CoFHE SDK | Boolean available | Public: "matched" |
| 7 | `clientFinalizeDeal(true)` | State = Matched | Both unseal **900** |
| 8 | Escrow created, linked, funded | 900 USDC in conditional escrow | Settlement in progress |
| 9 | Seller redeems escrow | Funds released | Settlement complete |

**If buyer max = 500, seller min = 800**: `gte(enc(500), enc(800))` → `enc(false)`. State = NoMatch. The values 500 and 800 are **never revealed to anyone, ever**.

---

## Privacy Model

### Always Public (On-Chain Plaintext)

| Data | Why |
|------|-----|
| Buyer & seller addresses | Role enforcement + ACL |
| Deal description | User-provided context |
| Deal state (Open / Matched / NoMatch / Cancelled / Expired) | Protocol state machine |
| Whether each party submitted | Coordination signal |
| Match result (boolean only) | Minimal disclosure |

### Always Encrypted (FHE Ciphertext)

| Data | Type | Revealed when | To whom |
|------|------|---------------|---------|
| Buyer's max price | `euint64` | Only on match | Both parties (as midpoint) |
| Seller's min price | `euint64` | Only on match | Both parties (as midpoint) |
| Deal price (midpoint) | `euint64` | Only on match | Both parties |

### Key Privacy Guarantees

1. **Failed negotiations leak nothing** — only a boolean "no match" is disclosed
2. **Individual prices never revealed** — even on match, only the midpoint is disclosed
3. **No front-running** — prices encrypted client-side before submission
4. **ACL-enforced access** — only authorized addresses can decrypt specific ciphertexts

---

## FHE Operations Deep Dive

The contract uses **6 distinct FHE operations** from `@fhenixprotocol/cofhe-contracts/FHE.sol`:

### 1. `FHE.asEuint64()` — Input Encryption

```solidity
d.buyerMax = FHE.asEuint64(encryptedMax);
```
Converts client-side encrypted input (ZK-proven) into an on-chain `euint64` ciphertext handle.

### 2. `FHE.gte()` — Encrypted Comparison

```solidity
ebool match_ = FHE.gte(d.buyerMax, d.sellerMin);
```
Computes `buyerMax >= sellerMin` on encrypted values. Returns an encrypted boolean — the contract **cannot read** the result.

### 3. `FHE.add()` — Encrypted Addition

```solidity
euint64 sum = FHE.add(d.buyerMax, d.sellerMin);
```

### 4. `FHE.div()` — Encrypted Division

```solidity
euint64 midpoint = FHE.div(sum, two);
```
Produces the fair deal price: `(buyerMax + sellerMin) / 2`.

### 5. `FHE.select()` — Encrypted Conditional

```solidity
d.dealPrice = FHE.select(match_, midpoint, zero);
```
FHE ternary: if match, return midpoint; else zero. You **cannot branch on encrypted data** — `select` is the pattern.

### 6. `ITaskManager.createDecryptTask()` + `decryptForView()` — Decryption

```solidity
// Request Threshold Network decryption (replaces FHE.decrypt in v0.5.x)
ITaskManager(TASK_MANAGER_ADDRESS).createDecryptTask(uint256(ebool.unwrap(d.isMatch)), address(this));
FHE.allowGlobal(d.isMatch);   // Enable client-side access
```
```typescript
// Client-side via CoFHE SDK v0.5.x
const matched = await cofheClient.decryptForView(matchHandle, FheTypes.Bool).execute();
```

---

## Escrow Settlement

After a deal matches, BlindDeal integrates with **Privara conditional escrow** (`@reineira-os/sdk`) for trustless ConfUSDC settlement:

### Flow

1. **Create Escrow** — API server creates a Privara escrow for the agreed price (viem with explicit ABI)
2. **Link to Condition** — Client calls resolver's `linkEscrow(escrowId, dealId)` (wagmi)
3. **Fund Escrow** — API server funds with ConfUSDC via hot wallet (viem, with simulated fallback for testnet)
4. **Redeem** — Seller redeems funds once the on-chain condition is verified (API server, simulated fallback)

### Why Server-Side?

The `@reineira-os/sdk` uses `@cofhe/sdk@0.5.2` internally, which requires Node.js native modules. Escrow create/fund/redeem are handled by **Vercel API routes** with a hot wallet. Link is a direct client-side transaction (no FHE needed).

### Explorer Links

After funding/redeeming, tx hashes are displayed with clickable links to `sepolia.arbiscan.io` for on-chain verification.

### Contracts (v5)

| Contract | Arbitrum Sepolia | Ethereum Sepolia | Purpose |
|----------|------------------|------------------|---------|
| **BlindDeal** | [`0xabf1...A65c`](https://sepolia.arbiscan.io/address/0xabf1161bEcf179A4Cb6604387273931E1d76A65c) | [`0xBed2...Bf10`](https://sepolia.etherscan.io/address/0xBed299e6e40233bD4Cac7bd472356F16e99EBf10) | Core FHE negotiation |
| **BlindDealResolver** | [`0x2248...5250`](https://sepolia.arbiscan.io/address/0x22480315309C85cdc2648cc6eD897ee96b755250) | [`0x6397...a53E`](https://sepolia.etherscan.io/address/0x639794F956A4b2CC2C62a5DF9eE71B29a7C7a53E) | Condition resolver |
| **ConfidentialEscrow** | [`0xbe1E...9A6`](https://sepolia.arbiscan.io/address/0xbe1EB78504B71beEE1b33D3E3D367A2F9a549A6) | — | Privara escrow (holds ConfUSDC) |
| **ConfidentialUSDC** | [`0x42E4...48a`](https://sepolia.arbiscan.io/address/0x42E47f9bA89712C317f60A72C81A610A2b68c48a) | — | FHE-wrapped USDC token |

v5 fix: `createDecryptTask` wrapped in `try/catch` because the Sepolia TASK_MANAGER doesn't support this function.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Frontend (React)                       │
│                                                          │
│  @cofhe/react          wagmi v2          Vercel API      │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────┐  │
│  │ encrypt()    │   │ writeContract│   │ /api/escrow │  │
│  │ decrypt()    │   │ readContract │   │ /create     │  │
│  │ unseal()     │   │              │   │ /fund       │  │
│  └──────┬───────┘   └──────┬───────┘   └──────┬──────┘  │
└─────────┼──────────────────┼───────────────────┼─────────┘
          │                  │                   │
          ▼                  ▼                   ▼
┌─────────────────┐  ┌──────────────┐  ┌────────────────┐
│  CoFHE          │  │ BlindDeal    │  │ Privara SDK    │
│  Coprocessor    │  │ .sol         │  │ @reineira-os/  │
│                 │  │              │  │ sdk (Node.js)  │
│  FHE math on   │  │ 6 FHE ops    │  │                │
│  ciphertext     │  │ ACL control  │  │ Escrow create  │
│                 │  │              │  │ Escrow fund    │
└─────────────────┘  └──────┬───────┘  └───────┬────────┘
                            │                  │
                            ▼                  ▼
                     ┌──────────────────────────────┐
                     │    Arbitrum Sepolia           │
                     │                              │
                     │  BlindDeal                   │
                     │  BlindDealResolver           │
                     │  ConfidentialEscrow (Privara) │
                     │  ConfidentialUSDC            │
                     └──────────────────────────────┘
```

---

## Live Demo

### Deployed (v5)

| Component | URL |
|-----------|-----|
| **Frontend** | Vercel deployment (Arbitrum Sepolia + Ethereum Sepolia) |
| **BlindDeal (Arb)** | [`0xabf1...A65c`](https://sepolia.arbiscan.io/address/0xabf1161bEcf179A4Cb6604387273931E1d76A65c) |
| **Resolver (Arb)** | [`0x2248...5250`](https://sepolia.arbiscan.io/address/0x22480315309C85cdc2648cc6eD897ee96b755250) |
| **BlindDeal (Eth)** | [`0xBed2...Bf10`](https://sepolia.etherscan.io/address/0xBed299e6e40233bD4Cac7bd472356F16e99EBf10) |

### Verified On-Chain

The complete escrow lifecycle has been verified on Arbitrum Sepolia:

- Escrow create with resolver condition (escrow #30+)
- ConfUSDC approval + fund via viem (bypasses ethers.js encoding bug)
- Condition-verified redeem with tx hash persisted to localStorage
- Explorer links: fund/redeem txs link to `sepolia.arbiscan.io`
- Escrow status persists across page reloads (fixes "redeem button still enabled" bug)

---

## Project Structure

```
blinddeal/
├── contracts/
│   ├── BlindDeal.sol              # Core FHE negotiation (v6: DealType, joinDeal)
│   └── BlindDealResolver.sol      # Privara escrow condition resolver
├── frontend/
│   ├── api/escrow/
│   │   ├── create.ts              # Vercel API: create escrow via Privara SDK (viem)
│   │   ├── fund.ts                # Vercel API: fund escrow with ConfUSDC (viem + ABI)
│   │   └── redeem.ts             # Vercel API: redeem escrow (viem direct call)
│   ├── src/
│   │   ├── components/
│   │   │   ├── CreateDeal.tsx      # Deal creation form (Direct/Open toggle)
│   │   │   ├── Dashboard.tsx       # My Deals + Marketplace tabs + activity tags
│   │   │   │   ├── MCPServer.tsx    # MCP tools test panel
│   │   │   ├── DealDetail.tsx      # Full lifecycle: negotiate → settle → cancel
│   │   │   ├── Header.tsx          # Navigation + wallet connection
│   │   │   └── Toast.tsx           # Notification system
│   │   ├── config/
│   │   │   ├── cofhe.tsx           # CoFHE SDK provider setup
│   │   │   ├── contract.ts         # ABIs, addresses, escrow config
│   │   │   └── wagmi.ts            # Wagmi + chain configuration
│   │   └── hooks/
│   │       └── useEscrow.ts        # Escrow state + tx hash persistence (localStorage)
│   ├── dev-api.mjs                 # Local dev API server (port 3002, viem)
│   └── vite.config.ts              # Custom CoFHE worker plugin
├── telegram-bot/
│   ├── index.ts                    # Telegram bot: notifications + /list /subscribe + event polling
│   └── package.json
├── mcp-server/
│   └── index.ts                    # MCP server (HTTP transport, Node.js CJS workaround)
├── start-bot.ts                    # Multi-service runner: MCP + Telegram as child processes
├── Procfile                        # Render worker: npx tsx start-bot.ts all
├── render.yaml                    # Render Background Worker deployment config
├── tasks/                          # Hardhat tasks (deploy, create, submit, finalize, verify, agent)
├── test/
│   └── BlindDeal.test.ts           # 34 tests (all passing, 7 new Open marketplace tests)
├── deployments/                    # Contract addresses per network
├── hardhat.config.ts
└── package.json
```

---

## Getting Started

### Prerequisites

- **Node.js** v20+
- **pnpm** (`npm install -g pnpm`)

### Install

```bash
git clone <your-repo-url> blinddeal
cd blinddeal
pnpm install
```

### Environment

```bash
cp .env.example .env
# Edit .env: set PRIVATE_KEY and RPC URLs
```

### Compile & Test

```bash
pnpm compile
pnpm test
```

### Deploy to Testnet

```bash
pnpm arb-sepolia:deploy-blinddeal
pnpm arb-sepolia:deploy-resolver
```

### Run Frontend + Services

**One command — all 4 services:**

```bash
pnpm dev:all
```

Launches with color-coded logs, port conflict detection, and auto-restart:

```
[frontend  ] http://localhost:3000     (Vite dev server)
[api       ] http://localhost:3002     (Escrow API — create/fund/redeem)
[mcp       ] http://localhost:3001     (MCP Server for AI agents)
[telegram  ] Bot running              (Telegram notifications)
```

Press `Ctrl+C` to stop all services.

**Or run individually:**

```bash
pnpm dev:fe          # Frontend only (:3000)
pnpm dev:api         # API server only (:3002)
pnpm mcp             # MCP Server only (:3001)
pnpm start:bot telegram  # Telegram bot only
pnpm start:bot       # MCP + Telegram (production-like)
```

Open `http://localhost:3000`

---

## Deployment

Full deployment guide in [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md).

| Component | Platform | Service |
|---|---|---|
| Frontend + Escrow API | **Vercel** | Serverless (auto-scaling) |
| MCP Server + Telegram Bot | **Render** | Background Worker (free tier) |

### Quick Deploy

```bash
# Vercel (frontend + API)
cd frontend
vercel --prod

# Render (MCP + Telegram)
# Import repo as Background Worker → start: npx tsx start-bot.ts all
```

Environment variables reference and step-by-step instructions in [`DEPLOYMENT_GUIDE.md`](./DEPLOYMENT_GUIDE.md).

---

## Usage — Hardhat Tasks

```bash
# Deploy
npx hardhat deploy-blinddeal --network arb-sepolia

# Create a deal
npx hardhat create-deal --network arb-sepolia \
  --seller 0xSellerAddress --description "Logo design"

# Create an Open marketplace deal (anyone can join)
npx hardhat create-deal --network arb-sepolia \
  --seller 0x0000000000000000000000000000000000000000 --description "Open deal"

# Submit encrypted prices
npx hardhat submit-price --network arb-sepolia \
  --deal 0 --price 1000 --role buyer

npx hardhat submit-price --network arb-sepolia \
  --deal 0 --price 800 --role seller

# Finalize
npx hardhat finalize-deal --network arb-sepolia --deal 0

# AI Agent: discover deals, join, submit price (demo command)
npx hardhat agent --price 500 --network arb-sepolia

# AI Agent: create Open deal + full flow demo
npx hardhat agent --mode full --price 500 --network arb-sepolia
```

---

## AI Agent

The agent autonomously discovers open marketplace deals, joins as a seller, and submits FHE-encrypted prices — all from the command line.

### How it works

1. **Discovers deals** — scans the contract for Open marketplace deals without a seller
2. **Joins as seller** — calls `joinDeal()` (first-come-first-served)
3. **Encrypts price** — uses `@cofhe/hardhat-plugin` for FHE encryption (runs in Node.js)
4. **Submits price** — calls `submitSellerPrice()` with encrypted input
5. **Finalizes** — decrypts match result and calls `finalizeDeal()`

### Demo commands

```bash
# Discover + join + submit (finds an Open deal automatically)
npx hardhat agent --price 500 --network arb-sepolia

# Full demo: create deal + join + submit buyer + submit seller + finalize
npx hardhat agent --mode full --price 500 --network arb-sepolia

# Create an Open deal for others to discover
npx hardhat create-deal --network arb-sepolia \
  --seller 0x0000000000000000000000000000000000000000 \
  --description "Open negotiation"
```

---

## Tests

34 tests across 7 categories using mock FHE (`@cofhe/hardhat-plugin`):

| Category | Tests | What's Verified |
|----------|-------|-----------------|
| **Deal Creation** | 5 | State init, ID increment, per-user tracking, deadline |
| **Price Submission** | 4 | Encrypted input, role enforcement, double-submit prevention |
| **Match Resolution** | 3 | FHE comparison, midpoint arithmetic, equal prices |
| **No Match** | 2 | FHE no-match, price privacy (revert on getDealPrice) |
| **Cancellation** | 4 | Buyer/seller cancel, outsider rejection, post-cancel rejection |
| **Deal Expiry** | 4 | Deadline enforcement, early expire rejection |
| **Open Marketplace** | 7 | joinDeal flow, Direct deal rejection, seller replacement, full Open deal lifecycle |

---

## Roadmap

### Wave 1 — Smart Contract Core ✅

- [x] `BlindDeal.sol` — FHE negotiation with 6 encrypted operations
- [x] ACL-based access control, deal deadlines, per-user tracking
- [x] 34 tests covering all paths
- [x] Hardhat tasks + deployed to Arbitrum Sepolia & Ethereum Sepolia

### Wave 2 — Frontend + Escrow Settlement ✅

- [x] React frontend with `@cofhe/react` hooks + wagmi wallet connection
- [x] Full deal lifecycle UI: create → submit encrypted prices → finalize → cancel
- [x] FHE price unsealing via `cofheClient.decryptForView()`
- [x] `BlindDealResolver.sol` — condition contract for Privara escrow
- [x] Privara SDK integration (`@reineira-os/sdk`): create → fund → redeem
- [x] Server-side API routes for FHE-encrypted escrow operations
- [x] End-to-end escrow lifecycle verified on Arbitrum Sepolia

### Wave 3 — Distribution + Polish ✅

- [x] **FHE Engine Upgrade** — Migrated to `@cofhe/sdk` / `@cofhe/hardhat-plugin` v0.5.2
- [x] **Smart contract v5** — `createDecryptTask` wrapped in try/catch, `Expired` state, `createdAt` timestamp
- [x] **Telegram bot** for deal notifications + share links (`/status`, `/share`, `/subscribe`)
- [x] **Multi-deal marketplace view** — Browse all open deals alongside "My Deals"
- [x] **Deal filters** — All / Open / Closed tabs on "My Deals"
- [x] **Live countdown timer** — Shows remaining time on open deals
- [x] **Share improvements** — Copy link + Telegram share button
- [x] **Address validation** — CreateDeal form validates seller address format
- [x] **Escrow rewrite** — All API routes use viem with explicit ABI (fixes ethers.js encoding bug)
- [x] **Persisted escrow state** — Status + tx hashes saved to localStorage, survives page reload
- [x] **Explorer links** — Fund/redeem tx hashes link to `sepolia.arbiscan.io`
- [x] **CCTP bridge removed** — Was irrelevant (bridges regular USDC, escrow needs ConfUSDC)
- [x] **Contract verification tasks** — `verify-blinddeal` and `verify-resolver` Hardhat tasks

### Wave 4 — Marketplace + Telegram Bot + MCP Server ✅

- [x] **Open marketplace deals** — `createDeal(address(0))` → `DealType.Open`, first-come-first-served via `joinDeal()`
- [x] **Open deal UI** — Seller card shows "Waiting for seller...", "Join as Seller" button, activity tags
- [x] **Marketplace view** — Search/filter by state, search by deal ID, "Load More" pagination, "Open for sellers" badge
- [x] **Telegram bot** — `/list`, `/status`, `/create`, `/submit`, `/share`, `/subscribe`, event polling every 15s
- [x] **Telegram deep-links** — `?action=create`, `?deal=X&action=submit`, `?action=mcp` from App.tsx
- [x] **MCP Server** — HTTP transport, 6 tools (`get_deal`, `list_deals`, `get_user_deals`, `get_events`, `subscribe_deal`, `create_deal`), 6 resources (`blinddeal://contract/*`, etc.)
- [x] **MCP page** — Interactive test buttons, Claude Desktop config guide, tool/resource listings
- [x] **Multi-service runner** — `start-bot.ts` spawns MCP + Telegram as child processes with auto-restart
- [x] **AI Agent task** — `npx hardhat agent --price 500 --network arb-sepolia` discovers Open deals, joins, submits FHE price
- [x] **34 Hardhat tests pass**, TypeScript clean, Vite build succeeds

### Wave 5

- [ ] MCP client integration — "Connect Agent" panel on `/mcp` page, test Claude Desktop connection
- [ ] Landing page — `/` page with protocol explanation + wallet CTA
- [ ] Browser push notifications — deal state changes in-browser (not just Telegram)
- [ ] On-chain reputation — track per-address deal completion rate, show on deal cards

### Wave 5 — Agent + Advanced Features (May 11–Jun 1)

- [ ] AI negotiation agent: auto-suggest price ranges based on market data
- [ ] Agent bidding: delegate encrypted price submission to an AI agent
- [ ] On-chain reputation scoring (deals completed, match rate, response time)
- [ ] Multiple price dimensions (price + timeline + scope)
- [ ] Landing page with protocol explanation
- [ ] Security review against FHE-specific patterns

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **FHE Contracts** | Solidity 0.8.25, `@fhenixprotocol/cofhe-contracts` v0.1.3 |
| **FHE Coprocessor** | Fhenix CoFHE (TaskManager, FHEOS, Threshold Network) |
| **Client SDK** | `@cofhe/sdk` v0.5.2 + `@cofhe/react` v0.5.2 (encrypt, decrypt, permits) |
| **Escrow** | Privara SDK (`@reineira-os/sdk` v0.3.1) — conditional ConfUSDC escrow |
| **Frontend** | Vite 8, React 18, wagmi v2, Tailwind CSS |
| **Dev Framework** | Hardhat 2.22, `@cofhe/hardhat-plugin` v0.5.2 (mock FHE testing) |
| **Blockchain** | Arbitrum Sepolia (escrow + FHE), Ethereum Sepolia (FHE only) |
| **Deployment** | Vercel (frontend + API), Hardhat (contracts) |

---

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
