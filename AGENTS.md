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
  src/components/    UI components (Dashboard, DealDetail, CreateDeal, etc.)
  src/config/        contract.ts (ABIs + addresses), cofhe.tsx, wagmi.ts
  api/escrow/        Vercel serverless API routes (create, fund, redeem)

telegram-bot/        Telegraf bot for deal notifications + share links

tasks/               Hardhat tasks (deploy, create-deal, submit-price, finalize, verify)
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

## Contract Deployments (v5)

| Chain | BlindDeal | Resolver |
|---|---|---|
| Arbitrum Sepolia | `0xabf1161bEcf179A4Cb6604387273931E1d76A65c` | `0x22480315309C85cdc2648cc6eD897ee96b755250` |
| Ethereum Sepolia | `0xBed299e6e40233bD4Cac7bd472356F16e99EBf10` | `0x639794F956A4b2CC2C62a5DF9eE71B29a7C7a53E` |

v5 fix: `createDecryptTask` wrapped in `try/catch` because the Sepolia TASK_MANAGER (`0xeA30c4B8...`) doesn't support this function.

## Smart Contract State Machine

```
Open → [both submit] → _resolve() → finalizeDeal() → Matched | NoMatch
Open → [cancel] → Cancelled
Open → [deadline passed] → Expired
```

**States:** `Open(0)`, `Matched(1)`, `NoMatch(2)`, `Cancelled(3)`, `Expired(4)`

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

**Important**: The Reineira SDK v0.3.1 uses different contract addresses than v0.2.0. The frontend's `contract.ts` must match the SDK's addresses.

### Escrow Contract Addresses (Reineira SDK v0.3.1)
| Contract | Arbitrum Sepolia Address |
|---|---|
| ConfUSDC | `0x42E47f9bA89712C317f60A72C81A610A2b68c48a` |
| Privara Escrow | `0xbe1EB78504B71beEE1b33D3E3D367A2F9a549A6` |

### Frontend Escrow State
- Escrow ID, status, and tx hashes are persisted to `localStorage` via `useEscrow.ts`
- Status values: `none | created | linking | linked | funded | redeemed`
- After redemption, status persists across page reloads (fixes "redeem button still enabled" bug)
- Fund/redeem tx hashes shown with explorer links (`sepolia.arbiscan.io` for Arbitrum Sepolia)

## Testing with Mock FHE

```typescript
const client = await hre.cofhe.createClientWithBatteries(signer)
const [enc] = await client.encryptInputs([Encryptable.uint64(100n)]).execute()

// Read plaintext directly from mock
await hre.cofhe.mocks.expectPlaintext(handle, 100n)
```

## Deployment

```bash
# Arbitrum Sepolia
pnpm arb-sepolia:deploy-blinddeal
pnpm arb-sepolia:deploy-resolver

# Ethereum Sepolia
pnpm eth-sepolia:deploy-blinddeal
pnpm eth-sepolia:deploy-resolver
```

After deployment, update `frontend/src/config/contract.ts` with new addresses.

## Environment Variables

Copy `.env.example` → `.env` and fill:

- `PRIVATE_KEY` — deployer + hot wallet
- `SEPOLIA_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL` — for contract deployment
- `VITE_SEPOLIA_RPC_URL` / `VITE_ARBITRUM_SEPOLIA_RPC_URL` — for frontend (must have VITE_ prefix)
- `ETHERSCAN_API_KEY` — for contract verification
- `TELEGRAM_BOT_TOKEN` — for telegram-bot notifications
- `FRONTEND_URL` — for share links and Vercel deployment

## Build & Test

```bash
pnpm install
pnpm compile        # Compile Solidity
pnpm test           # Run Hardhat tests (27 tests)
cd frontend && npx tsc --noEmit   # Type-check frontend
cd frontend && npx vite build     # Production build
```

## Common Issues

1. **"FHE.decrypt not found"** — You're on old cofhe-contracts. Use `ITaskManager.createDecryptTask()` (wrapped in try/catch).
2. **Worker not loading in dev** — The `cofhe-worker-serve` Vite plugin handles `zkProve.worker.js`.
3. **"Loading deal..." stuck** — Check that `VITE_SEPOLIA_RPC_URL` is set in `.env`. Public RPCs are rate-limited.
4. **"Do not know how to serialize a BigInt"** — Convert BigInt to string before `JSON.stringify`.
5. **Escrow fund reverts with ECDSAInvalidSignatureS** — The verifier API sometimes returns normalized signatures. Reineira SDK v0.3.1 uses `@cofhe/sdk@0.5.2` which handles this.
6. **Toast not auto-closing** — Ensure `update(tid, 'success', msg)` is called after tx confirms. Use `publicClient.waitForTransactionReceipt` for reliable confirmation.
7. **Type errors with viem wallet client** — Always pass `account` to `writeContract` in viem v2.

## Code Style

- **Solidity**: 0.8.25, `cancun` EVM, custom errors, NatSpec comments
- **TypeScript**: Strict mode, explicit types on function params
- **Frontend**: Tailwind utilities, glassmorphism via `.glass` class, no inline styles
- **Naming**: `camelCase` for vars, `PascalCase` for components/contracts, `SCREAMING_SNAKE` for constants
