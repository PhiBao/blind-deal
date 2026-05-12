# BlindDeal — Agent Guide

> Quick reference for AI agents working on this codebase.

## Project Overview

BlindDeal is a confidential P2P price negotiation protocol using Fully Homomorphic Encryption (FHE) on Fhenix/Arbitrum Sepolia. Two parties submit encrypted prices; the smart contract computes match and midpoint entirely on ciphertext.

## Architecture

```
contracts/           Solidity (Hardhat)
  BlindDeal.sol      Core FHE negotiation (create → submit → resolve → finalize)
  BlindDealResolver.sol  Privara escrow condition checker

frontend/            React + Vite + wagmi v2
  src/components/    UI components (Dashboard, DealDetail, CreateDeal, MCPServer, etc.)
  src/config/        contract.ts (ABIs + addresses), cofhe.tsx, wagmi.ts
  api/escrow/        Vercel serverless API routes (create, fund, redeem)

telegram-bot/        Telegraf bot: notifications + deep-links + /list /create /submit
mcp-server/          MCP server with HTTP transport for AI agent integration
start-bot.ts         Multi-service runner (spawns MCP + Telegram together)

tasks/               Hardhat tasks (deploy, create-deal, submit-price, finalize, verify, agent)
test/                Hardhat tests with @cofhe/hardhat-plugin mock FHE
```

## Key Tech Stack

| Layer | Package | Version |
|---|---|---|
| FHE Contracts | `@fhenixprotocol/cofhe-contracts` | ^0.1.3 |
| FHE Client SDK | `@cofhe/sdk` | ^0.5.2 |
| React SDK | `@cofhe/react` | ^0.5.2 |
| Hardhat Plugin | `@cofhe/hardhat-plugin` | ^0.5.2 |
| Frontend | React 18, wagmi v2, viem, Tailwind | latest |
| Escrow | `@reineira-os/sdk` | ^0.3.1 |
| MCP Server | `@modelcontextprotocol/sdk` | ^1.29.0 |
| Telegram Bot | `telegraf` | ^4.16.3 |

## Contract Deployments

| Chain | BlindDeal | Resolver |
|---|---|---|
| Arbitrum Sepolia | `0xabf1161bEcf179A4Cb6604387273931E1d76A65c` | `0x22480315309C85cdc2648cc6eD897ee96b755250` |
| Ethereum Sepolia | `0xBed299e6e40233bD4Cac7bd472356F16e99EBf10` | `0x639794F956A4b2CC2C62a5DF9eE71B29a7C7a53E` |

`createDecryptTask` wrapped in `try/catch` because the Sepolia TASK_MANAGER doesn't support this function.

## Smart Contract State Machine

```
Open → [both submit] → _resolve() → finalizeDeal() → Matched | NoMatch
Open → [cancel] → Cancelled
Open → [deadline passed] → Expired
```

**States:** `Open(0)`, `Matched(1)`, `NoMatch(2)`, `Cancelled(3)`, `Expired(4)`

**Deal Types:** `Direct(0)`, `Open(1)` — Open deals use `address(0)` as placeholder seller, first-come-first-served via `joinDeal()`.

## Critical Patterns

### FHE Operations in BlindDeal.sol

1. `FHE.asEuint64(encryptedInput)` — convert ZK-proven input to on-chain ciphertext
2. `FHE.gte(a, b)` — encrypted comparison
3. `FHE.add(a, b)` — encrypted addition
4. `FHE.div(a, b)` — encrypted division
5. `FHE.select(condition, ifTrue, ifFalse)` — encrypted ternary (no branching on ciphertext)
6. `ITaskManager.createDecryptTask(ctHash, requestor)` — request Threshold Network decryption (wrapped in try/catch for testnet compatibility)

### ACL (Access Control)

- `FHE.allowThis(handle)` — allow the contract to use the handle
- `FHE.allow(handle, address)` — allow a specific address to decrypt
- `FHE.allowGlobal(handle)` — allow anyone to decrypt (used for match result)

### Open Deal Flow

1. Buyer creates Open deal: `createDeal(address(0), description, minPrice, maxPrice, deadline)`
2. Anyone can join: `joinDeal(dealId)` — fills the seller slot
3. Both submit prices: `submitBuyerPrice()` / `submitSellerPrice()`
4. Resolve + finalize like normal

### Frontend Key Patterns

- **RPC URLs**: Must use `VITE_` prefix for Vite env vars. Configured in wagmi.ts via `import.meta.env.VITE_SEPOLIA_RPC_URL`
- **envDir**: `vite.config.ts` sets `envDir: '..'` to load `.env` from workspace root
- **Worker**: `useWorkers: false` in cofhe.tsx — disables Web Worker for ZK proof generation to avoid WASM thread pool issues
- **Signatures**: Always ensure `0x` prefix before passing to viem `writeContract`
- **Receipt tracking**: Use `publicClient.waitForTransactionReceipt` instead of `useWaitForTransactionReceipt` (more reliable on Arbitrum Sepolia)
- **BigInt serialization**: `JSON.stringify` can't handle BigInt — convert to string before sending to API

## Escrow Flow (Privara)

1. **Create** → API server calls `ReineiraSDK.create()` (v0.3.1, uses `@cofhe/sdk@0.5.2`)
2. **Link** → Client calls resolver's `linkEscrow(escrowId, dealId)`
3. **Fund** → API server calls `escrow.fund(amount)` (with simulated fallback for testnet)
4. **Redeem** → API server calls `escrow.redeem()` (with simulated fallback for testnet)

### Escrow Contract Addresses (Reineira SDK v0.3.1)
| Contract | Arbitrum Sepolia Address |
|---|---|
| ConfUSDC | `0x42E47f9bA89712C317f60A72C81A610A2b68c48a` |
| Privara Escrow | `0xbe1EB78504B71beEE1b33D3E3D367A2F9a549A6` |

### Frontend Escrow State
- Escrow ID, status, and tx hashes are persisted to `localStorage` via `useEscrow.ts`
- Status values: `none | created | linking | linked | funded | redeemed`
- After redemption, status persists across page reloads
- Fund/redeem tx hashes shown with explorer links (`sepolia.arbiscan.io` for Arbitrum Sepolia)

## Telegram Bot

Long-running process. Start locally: `pnpm start:bot telegram`

**Commands:** `/start` `/help` `/list` `/status` `/create` `/submit` `/share` `/subscribe` `/unsubscribe` `/subscriptions`

**Event polling:** Every 15s, checks contract events and notifies subscribers.

**Config env vars:**
- `TELEGRAM_BOT_TOKEN` — bot token from @BotFather
- `TELEGRAM_BOT_USERNAME` — username (e.g. `BlindDealBot`)
- `FRONTEND_URL` — for deep-links (e.g. `https://blind-deal.vercel.app`)

## MCP Server

HTTP-based MCP server using `@modelcontextprotocol/sdk` with Streamable HTTP transport.

**Start locally:** `pnpm mcp` or `pnpm start:bot mcp`

**Endpoints:**
- `POST /mcp` — MCP JSON-RPC requests
- `GET /mcp` — SSE streaming (for protocol negotiation)
- `GET /health` — Health check

**Tools available:**
| Tool | Description |
|---|---|
| `get_deal` | Fetch deal state, parties, description, submission status |
| `list_deals` | List marketplace deals with state/type filtering |
| `get_user_deals` | Get all deals for a wallet address |
| `get_events` | Fetch recent contract events |
| `subscribe_deal` | Subscribe to deal notifications |
| `create_deal` | Info only (requires wallet for on-chain tx) |

**Resources available:**
- `blinddeal://contract/arbitrum-sepolia` — contract address + explorer
- `blinddeal://contract/ethereum-sepolia` — contract address + explorer
- `blinddeal://schema/deal` — deal data schema
- `blinddeal://events` — all event types
- `blinddeal://deal-types` — Direct(0) / Open(1)
- `blinddeal://deal-states` — Open/Matched/NoMatch/Cancelled/Expired

**Connect Claude Desktop:**
```json
{
  "mcpServers": {
    "blinddeal": {
      "command": "npx tsx",
      "args": ["mcp-server/index.ts"]
    }
  }
}
```

## Telegram Deep-Links

Telegram bot commands generate deep-links to the frontend:

| URL Format | Effect |
|---|---|
| `{FRONTEND_URL}?deal=42&chain=421614` | Opens deal #42 detail |
| `{FRONTEND_URL}?action=create` | Opens deal creation page |
| `{FRONTEND_URL}?deal=42&action=submit` | Opens deal #42 with submit intent |
| `{FRONTEND_URL}?action=mcp` | Opens MCP page |

App.tsx reads `?deal=` and `?action=` on mount and navigates accordingly.

## AI Agent

Hardhat task that autonomously discovers Open marketplace deals, joins as seller, and submits FHE-encrypted prices.

```bash
# Discover + join + submit (uses account[1] as agent seller)
npx hardhat agent --price 500 --network arb-sepolia

# Full demo: create → join → submit buyer → submit seller → finalize
npx hardhat agent --mode full --price 500 --network arb-sepolia
```

Uses `@cofhe/hardhat-plugin` for FHE encryption in Node.js.

## Multi-Service Runner

Both Telegram bot and MCP server run together on Render as a Background Worker.

**start-bot.ts** spawns both as child processes with auto-restart on crash.

```bash
pnpm start:bot           # Run both MCP + Telegram
pnpm start:bot mcp       # MCP only
pnpm start:bot telegram  # Telegram only
```

**Render deployment:** Use `render.yaml` — Background Worker type, start command `npx tsx start-bot.ts all`

## Environment Variables

Copy `.env.example` → `.env` and fill:

| Variable | Purpose |
|---|---|
| `PRIVATE_KEY` | Deployer + hot wallet |
| `SEPOLIA_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL` | Contract deployment |
| `VITE_SEPOLIA_RPC_URL` / `VITE_ARBITRUM_SEPOLIA_RPC_URL` | Frontend (VITE_ prefix) |
| `ETHERSCAN_API_KEY` | Contract verification |
| `TELEGRAM_BOT_TOKEN` | Telegram bot |
| `TELEGRAM_BOT_USERNAME` | Bot username (e.g. `BlindDealBot`) |
| `FRONTEND_URL` | Deep-links (e.g. `https://blind-deal.vercel.app`) |
| `MCP_PORT` | MCP server port (default 3001) |
| `VITE_TELEGRAM_BOT_USERNAME` | Frontend bot username (VITE_ prefix) |
| `VITE_MCP_ENDPOINT` | Frontend MCP endpoint (VITE_ prefix) |

## Build & Test

```bash
pnpm install
pnpm compile        # Compile Solidity
pnpm test           # Run Hardhat tests (34 tests)
cd frontend && npx tsc --noEmit   # Type-check frontend
cd frontend && npx vite build     # Production build
```

## Common Issues

1. **"FHE.decrypt not found"** — Use `ITaskManager.createDecryptTask()` (wrapped in try/catch).
2. **Worker not loading in dev** — The `cofhe-worker-serve` Vite plugin handles `zkProve.worker.js`.
3. **"Loading deal..." stuck** — Check that `VITE_SEPOLIA_RPC_URL` is set. Public RPCs are rate-limited.
4. **"Do not know how to serialize a BigInt"** — Convert BigInt to string before `JSON.stringify`.
5. **Escrow fund reverts with ECDSAInvalidSignatureS** — Reineira SDK v0.3.1 handles this.
6. **Toast not auto-closing** — Use `publicClient.waitForTransactionReceipt` for reliable confirmation.
7. **Type errors with viem wallet client** — Always pass `account` to `writeContract` in viem v2.
8. **MCP Server not starting** — Uses CJS require because `@modelcontextprotocol/sdk` ESM exports are broken in Node 23. All `require()` calls use relative paths via `__dirname` for Render compatibility.

## Code Style

- **Solidity**: 0.8.25, `cancun` EVM, custom errors, NatSpec comments
- **TypeScript**: Strict mode, explicit types on function params
- **Frontend**: Tailwind utilities, glassmorphism via `.glass` class, no inline styles
- **Naming**: `camelCase` for vars, `PascalCase` for components/contracts, `SCREAMING_SNAKE` for constants
