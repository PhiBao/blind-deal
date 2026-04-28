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
  src/utils/         cctp.ts (Circle CCTP v2 bridge)
  api/escrow/        Vercel serverless API routes (create, fund)

telegram-bot/        Telegraf bot for deal notifications + share links

tasks/               Hardhat tasks (deploy, create-deal, submit-price, finalize, verify)
test/                Hardhat tests with @cofhe/hardhat-plugin mock FHE
```

## Key Tech Stack

| Layer | Package | Version |
|---|---|---|
| FHE Contracts | `@fhenixprotocol/cofhe-contracts` | ^0.1.3 |
| FHE Client SDK | `@cofhe/sdk` | ^0.5.1 |
| React SDK | `@cofhe/react` | ^0.5.1 |
| Hardhat Plugin | `@cofhe/hardhat-plugin` | ^0.5.1 |
| Frontend | React 18, wagmi v2, viem, Tailwind | latest |
| Escrow | `@reineira-os/sdk` | 0.2.0 |

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
6. `ITaskManager.createDecryptTask(ctHash, requestor)` — request Threshold Network decryption (v0.5.x pattern)

### ACL (Access Control)

- `FHE.allowThis(handle)` — allow the contract to use the handle
- `FHE.allow(handle, address)` — allow a specific address to decrypt
- `FHE.allowGlobal(handle)` — allow anyone to decrypt (used for match result)

### Testing with Mock FHE

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
- `SEPOLIA_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL`
- `ETHERSCAN_API_KEY` / `ARBISCAN_API_KEY`
- `TELEGRAM_BOT_TOKEN` — for telegram-bot
- `FRONTEND_URL` — for share links

## Build & Test

```bash
pnpm install
pnpm compile        # Compile Solidity
pnpm test           # Run Hardhat tests (27 tests)
cd frontend && npx tsc --noEmit   # Type-check frontend
```

## Common Issues

1. **"FHE.decrypt not found"** — You're on old cofhe-contracts. Use `ITaskManager.createDecryptTask()` instead.
2. **Worker not loading in dev** — The `cofhe-worker-serve` Vite plugin handles `zkProve.worker.js`.
3. **Type errors with viem wallet client** — Always pass `account` to `writeContract` in viem v2.

## Code Style

- **Solidity**: 0.8.25, `cancun` EVM, custom errors, NatSpec comments
- **TypeScript**: Strict mode, explicit types on function params
- **Frontend**: Tailwind utilities, glassmorphism via `.glass` class, no inline styles
- **Naming**: `camelCase` for vars, `PascalCase` for components/contracts, `SCREAMING_SNAKE` for constants
