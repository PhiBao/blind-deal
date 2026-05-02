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

After a deal matches, BlindDeal integrates with **Privara conditional escrow** (`@reineira-os/sdk`) for trustless USDC settlement:

### Flow

1. **Create Escrow** — Server-side API creates a Privara escrow for the agreed price, linked to `BlindDealResolver`
2. **Link to Condition** — Escrow is bound to an on-chain condition: the BlindDeal must be in `Matched` state
3. **Fund Escrow** — Buyer funds with FHE-encrypted Confidential USDC via server-side hot wallet
4. **Redeem** — Seller redeems funds once the on-chain condition is verified

### Why Server-Side?

The `cofhejs` FHE library (used internally by `@reineira-os/sdk`) requires Node.js native modules that don't run in browser. Escrow create/fund are handled by **Vercel API routes** with a hot wallet. Link and redeem are direct client-side transactions (no FHE needed).

### Contracts

| Contract | Address (Arb Sepolia) | Purpose |
|----------|----------------------|---------|
| **BlindDeal** | [`0x8028...906C5`](https://sepolia.arbiscan.io/address/0x802841705BF377a01C050E26a4488598001906C5) | Core FHE negotiation v4 (clean redeploy) |
| **BlindDealResolver** | [`0xe3ED...D23b`](https://sepolia.arbiscan.io/address/0xe3ED4E5585659654eC2FAE8d36aa7120fE8aD23b) | Condition resolver — true when deal is Matched |
| **ConfidentialEscrow** | [`0xC433...60Fa`](https://sepolia.arbiscan.io/address/0xC4333F84F5034D8691CB95f068def2e3B6DC60Fa) | Privara escrow (holds FHE-encrypted USDC) |
| **ConfidentialUSDC** | [`0x6b6e...f89f`](https://sepolia.arbiscan.io/address/0x6b6e6479b8b3237933c3ab9d8be969862d4ed89f) | FHE-wrapped USDC token |

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

### Deployed

| Component | URL |
|-----------|-----|
| **Frontend** | Vercel deployment (Arbitrum Sepolia + Ethereum Sepolia) |
| **BlindDeal** | [`0x8028...906C5`](https://sepolia.arbiscan.io/address/0x802841705BF377a01C050E26a4488598001906C5) |
| **Resolver** | [`0xe3ED...D23b`](https://sepolia.arbiscan.io/address/0xe3ED4E5585659654eC2FAE8d36aa7120fE8aD23b) |

### Verified On-Chain

The complete escrow lifecycle has been verified on Arbitrum Sepolia:

- Escrow create with resolver condition (escrow #61)
- USDC operator approval + FHE-encrypted fund (escrow #61)
- Condition-verified redeem (escrow #60)
- Multiple additional escrows created via API routes (#62, #63)

---

## Project Structure

```
blinddeal/
├── contracts/
│   ├── BlindDeal.sol              # Core FHE negotiation
│   └── BlindDealResolver.sol      # Privara escrow condition resolver
├── frontend/
│   ├── api/escrow/
│   │   ├── create.ts              # Vercel API: create escrow via Privara SDK
│   │   └── fund.ts                # Vercel API: fund escrow via Privara SDK
│   ├── src/
│   │   ├── components/
│   │   │   ├── CreateDeal.tsx      # Deal creation form
│   │   │   ├── Dashboard.tsx       # My Deals + Marketplace tabs
│   │   │   ├── DealDetail.tsx      # Full lifecycle: negotiate → settle (CCTP)
│   │   │   ├── Header.tsx          # Navigation + wallet connection
│   │   │   └── Toast.tsx           # Notification system
│   │   ├── config/
│   │   │   ├── cofhe.tsx           # CoFHE SDK provider setup
│   │   │   ├── contract.ts         # ABIs, addresses, escrow config
│   │   │   └── wagmi.ts            # Wagmi + chain configuration
│   │   ├── hooks/
│   │   │   └── useEscrow.ts        # Escrow state persistence
│   │   └── utils/
│   │       └── cctp.ts             # Circle CCTP v2 bridge logic
│   ├── dev-api.mjs                 # Local dev API server (port 3002)
│   └── vite.config.ts              # Custom CoFHE worker plugin
├── telegram-bot/
│   ├── index.ts                    # Telegram bot: notifications + share links
│   └── package.json                # Bot dependencies
├── test/
│   └── BlindDeal.test.ts           # 25 tests (all passing)
├── tasks/                          # Hardhat tasks (deploy, create, submit, finalize, verify)
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

### Run Frontend

```bash
# Terminal 1: API server (escrow operations via Privara SDK)
cd frontend && pnpm dev:api

# Terminal 2: Vite dev server (proxies /api → port 3002)
cd frontend && pnpm dev
```

Open `http://localhost:3000`

---

## Usage — Hardhat Tasks

```bash
# Deploy
npx hardhat deploy-blinddeal --network arb-sepolia

# Create a deal
npx hardhat create-deal --network arb-sepolia \
  --seller 0xSellerAddress --description "Logo design"

# Submit encrypted prices
npx hardhat submit-price --network arb-sepolia \
  --deal 0 --price 1000 --role buyer

npx hardhat submit-price --network arb-sepolia \
  --deal 0 --price 800 --role seller

# Finalize
npx hardhat finalize-deal --network arb-sepolia --deal 0
```

---

## Tests

27 tests across 6 categories using mock FHE (`@cofhe/hardhat-plugin`):

| Category | Tests | What's Verified |
|----------|-------|-----------------|
| **Deal Creation** | 5 | State init, ID increment, per-user tracking, deadline |
| **Price Submission** | 4 | Encrypted input, role enforcement, double-submit prevention |
| **Match Resolution** | 3 | FHE comparison, midpoint arithmetic, equal prices |
| **No Match** | 2 | FHE no-match, price privacy (revert on getDealPrice) |
| **Cancellation** | 4 | Buyer/seller cancel, outsider rejection, post-cancel rejection |
| **Deal Expiry** | 4 | Deadline enforcement, early expire rejection |

---

## Roadmap

### Wave 1 — Smart Contract Core ✅

- [x] `BlindDeal.sol` — FHE negotiation with 6 encrypted operations
- [x] ACL-based access control, deal deadlines, per-user tracking
- [x] 27 tests covering all paths
- [x] Hardhat tasks + deployed to Arbitrum Sepolia & Ethereum Sepolia

### Wave 2 — Frontend + Escrow Settlement ✅

- [x] React frontend with `@cofhe/react` hooks + wagmi wallet connection
- [x] Full deal lifecycle UI: create → submit encrypted prices → finalize → cancel
- [x] FHE price unsealing via `cofheClient.decryptForView()`
- [x] `BlindDealResolver.sol` — condition contract for Privara escrow
- [x] Privara SDK integration (`@reineira-os/sdk`): create → fund → redeem
- [x] Server-side API routes for FHE-encrypted escrow operations
- [x] End-to-end escrow lifecycle verified on Arbitrum Sepolia

### Wave 3 — Distribution + Polish

- [x] **FHE Engine Upgrade** — Migrated from `cofhejs` / `cofhe-hardhat-plugin` v0.3.x to `@cofhe/sdk` / `@cofhe/hardhat-plugin` v0.5.1
- [x] **Smart contract v2** — Added `Expired` state, `createdAt` timestamp, max deadline cap (365 days), `DealExpired` event, gas optimization
- [x] **Telegram bot** for deal notifications + share links (`/status`, `/share`, `/subscribe`, `/unsubscribe`)
- [x] **Multi-deal marketplace view** — Browse all open deals alongside "My Deals"
- [x] **Deal filters** — All / Open / Closed tabs on "My Deals"
- [x] **Live countdown timer** — Shows remaining time on open deals
- [x] **Share improvements** — Copy link + Telegram share button on deal detail
- [x] **Address validation** — CreateDeal form validates seller address format and self-deal prevention
- [x] **Cross-chain USDC settlement via CCTP** — Bridge USDC from Ethereum Sepolia → Arbitrum Sepolia, then fund escrow
- [x] **Contract verification tasks** — `verify-blinddeal` and `verify-resolver` Hardhat tasks
### Wave 4 — Multi-Deal Marketplace (Apr 21–May 10)

- [ ] Multi-deal marketplace: browse open deals, deal history
- [ ] Bid from Telegram: `/create`, `/submit <price>`, `/status <dealId>` commands
- [ ] Deep-link Telegram → frontend for wallet signing flows

### Wave 5 — Agent + Advanced Features (May 11–Jun 1)

- [ ] AI negotiation agent: auto-suggest price ranges based on market data
- [ ] Agent bidding: delegate encrypted price submission to an AI agent
- [ ] On-chain reputation scoring (deals completed, match rate, response time)
- [ ] Multiple price dimensions (price + timeline + scope)
- [ ] Cross-chain settlement via CCTP (fund from Ethereum Sepolia, settle on Arb)
- [ ] Landing page with protocol explanation
- [ ] Security review against FHE-specific patterns

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **FHE Contracts** | Solidity 0.8.25, `@fhenixprotocol/cofhe-contracts` v0.1.3 |
| **FHE Coprocessor** | Fhenix CoFHE (TaskManager, FHEOS, Threshold Network) |
| **Client SDK** | `@cofhe/sdk` v0.5.1 + `@cofhe/react` v0.5.1 (encrypt, decrypt, permits) |
| **Escrow** | Privara SDK (`@reineira-os/sdk`) — conditional FHE-encrypted USDC escrow |
| **Frontend** | Vite 8, React 18, wagmi v2, MUI + Tailwind CSS |
| **Dev Framework** | Hardhat 2.22, `@cofhe/hardhat-plugin` v0.5.1 (mock FHE testing) |
| **Cross-chain** | Circle CCTP v2 (Ethereum Sepolia → Arbitrum Sepolia) |
| **Distribution** | Telegram bot (deal notifications, share links, status) |
| **Deployment** | Arbitrum Sepolia, Ethereum Sepolia, Vercel |

---

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
