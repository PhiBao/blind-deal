# BlindDeal

**Confidential P2P Price Negotiation on Fhenix**

> Two parties negotiate a price without ever revealing their numbers — unless they agree.

Built with [Fhenix CoFHE](https://docs.fhenix.io) (Fully Homomorphic Encryption) for the **Privacy-by-Design dApp Buildathon**.

---

## Table of Contents

- [What is BlindDeal?](#what-is-blinddeal)
- [Why BlindDeal?](#why-blinddeal)
- [How It Works](#how-it-works)
- [What's Encrypted vs. What's Public](#whats-encrypted-vs-whats-public)
- [FHE Operations Deep Dive](#fhe-operations-deep-dive)
- [Architecture](#architecture)
- [Live Deployments](#live-deployments)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Usage — Hardhat Tasks](#usage--hardhat-tasks)
- [Tests](#tests)
- [Supported Networks](#supported-networks)
- [Roadmap](#roadmap)
- [Tech Stack](#tech-stack)
- [License](#license)

---

## What is BlindDeal?

BlindDeal is a **sealed-bid negotiation protocol** where:

1. A **buyer** submits their **maximum acceptable price** (encrypted)
2. A **seller** submits their **minimum acceptable price** (encrypted)
3. The smart contract computes — entirely on encrypted data — whether the prices overlap
4. **If they match**: the deal closes at the **midpoint price**, revealed only to both parties
5. **If they don't match**: **neither price is ever revealed** — zero information leakage

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
| **Novel** | Fresh angle |
| **Privacy-native** | Cannot exist without FHE — not a "privacy-bolted-on" project |
| **Real use case** | Salary negotiation, OTC deals, service pricing |
| **FHE depth** | Uses 6 different FHE operations (not just encrypt/decrypt) |
| **Privara integration** | Natural fit for escrow-based settlement |
| **Demo-friendly** | Two wallets, suspense moment, clear outcome |

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
│  4. FHE.decrypt(isMatch)                 │
│     → request Threshold Network decrypt  │
└──────────────┬───────────────────────────┘
               │  Threshold Network decrypts isMatch
               ▼
┌──────────────────────────────────────────┐
│        finalizeDeal()                    │
│                                          │
│  reads decrypted isMatch:               │
│                                          │
│  ✅ Match → DealState: Matched           │
│     Both parties get access to dealPrice │
│     (can unseal via SDK)                 │
│                                          │
│  ❌ No Match → DealState: NoMatch        │
│     Neither price is ever revealed       │
│     Privacy fully preserved              │
└──────────────────────────────────────────┘
```

### Step-by-Step Walkthrough

**Example: Buyer max = 1000, Seller min = 800**

| Step | Action | On-Chain State | Who Sees What |
|------|--------|----------------|---------------|
| 1 | Buyer calls `createDeal(seller, "Logo design")` | Deal #0 created, state = Open | Both parties see deal exists |
| 2 | Buyer encrypts `1000` client-side, calls `submitBuyerPrice(0, enc(1000))` | `buyerMax` = ciphertext, `buyerSubmitted` = true | Nobody sees 1000 — it's FHE-encrypted |
| 3 | Seller encrypts `800` client-side, calls `submitSellerPrice(0, enc(800))` | `sellerMin` = ciphertext, `sellerSubmitted` = true | Nobody sees 800 — it's FHE-encrypted |
| 4 | Contract auto-triggers `_resolve()` | Computes `gte(enc(1000), enc(800))` → `enc(true)` | Contract can't see the result — it's encrypted |
| 5 | Contract computes midpoint | `add(enc(1000), enc(800))` → `enc(1800)` → `div(enc(1800), enc(2))` → `enc(900)` | Still all encrypted |
| 6 | Threshold Network decrypts `isMatch` | Decrypted result becomes available | Public: "deal matched" (boolean only) |
| 7 | Anyone calls `finalizeDeal(0)` | State = Matched, ACL grants price access | Buyer and seller can now unseal `900` |

**If buyer max = 500, seller min = 800**: `gte(enc(500), enc(800))` → `enc(false)`. After decryption, state = NoMatch. The values 500 and 800 are **never revealed to anyone, ever**.

---

## What's Encrypted vs. What's Public

This is the core privacy model. Understanding what's hidden and what's visible is critical.

### Always Public (Plaintext On-Chain)

| Data | Why it's public |
|------|-----------------|
| Buyer address | Needed for role enforcement and ACL |
| Seller address | Needed for role enforcement and ACL |
| Deal description | User-provided context string |
| Deal state (`Open`, `Matched`, `NoMatch`, `Cancelled`) | Protocol logic requires state transitions |
| Whether each party has submitted | Coordination signal (boolean flags) |
| Whether the deal matched or not | Decrypted `isMatch` boolean — minimal information |

### Always Encrypted (FHE Ciphertext)

| Data | Type | When revealed | To whom |
|------|------|---------------|---------|
| Buyer's maximum price | `euint64` | Only on match | Buyer & seller only (as midpoint) |
| Seller's minimum price | `euint64` | Only on match | Buyer & seller only (as midpoint) |
| Whether prices overlap | `ebool` | After Threshold Network decrypts | Public (just the boolean) |
| Deal price (midpoint) | `euint64` | Only on match | Buyer & seller only |

### Key Privacy Guarantees

1. **Failed negotiations leak nothing**: If buyer max < seller min, neither the buyer's `1000` nor the seller's `800` is ever revealed. Only the boolean "no match" is disclosed.

2. **Exact prices never revealed**: Even on a successful match, individual prices stay encrypted. Only the midpoint is disclosed to the two parties.

3. **No front-running**: Prices are encrypted before submission. Miners, validators, and MEV bots cannot see them.

4. **Access control enforced on-chain**: The Fhenix ACL system (`FHE.allow()`) ensures only authorized addresses can decrypt specific ciphertexts.

---

## FHE Operations Deep Dive

The contract uses 6 distinct FHE operations from `@fhenixprotocol/cofhe-contracts/FHE.sol`:

### 1. `FHE.asEuint64(InEuint64)` — Input Encryption

```solidity
d.buyerMax = FHE.asEuint64(encryptedMax);
```

Converts client-side encrypted input (ZK-proven) into an on-chain `euint64` ciphertext handle. The client uses `cofhejs.encrypt([Encryptable.uint64(1000n)])` to produce the `InEuint64` struct.

### 2. `FHE.gte(euint64, euint64)` — Encrypted Comparison

```solidity
ebool match_ = FHE.gte(d.buyerMax, d.sellerMin);
```

Computes `buyerMax >= sellerMin` on encrypted values using the CoFHE coprocessor. Returns an encrypted boolean — the contract **cannot read** the result. This is the core of the negotiation: determining overlap without seeing either number.

### 3. `FHE.add(euint64, euint64)` — Encrypted Addition

```solidity
euint64 sum = FHE.add(d.buyerMax, d.sellerMin);
```

Adds two encrypted 64-bit values. Used to compute `buyerMax + sellerMin` as the first step of midpoint calculation.

### 4. `FHE.div(euint64, euint64)` — Encrypted Division

```solidity
euint64 midpoint = FHE.div(sum, two);
```

Divides encrypted sum by encrypted `2`. Produces the fair deal price: `(buyerMax + sellerMin) / 2`.

### 5. `FHE.select(ebool, euint64, euint64)` — Encrypted Conditional

```solidity
d.dealPrice = FHE.select(match_, midpoint, zero);
```

Encrypted ternary: if `match_` is true (encrypted), return `midpoint`; else return `zero`. This is the FHE equivalent of `if/else` — you **cannot branch on encrypted data** in traditional Solidity, so `select` is the pattern.

### 6. `FHE.decrypt()` + `FHE.getDecryptResultSafe()` — Threshold Decryption

```solidity
FHE.decrypt(d.isMatch);
// ... later ...
(bool matched, bool decrypted) = FHE.getDecryptResultSafe(d.isMatch);
```

Requests the Threshold Network to decrypt the match boolean. This is a two-step async process:
1. `decrypt()` submits the request on-chain
2. The Threshold Network (multi-party computation) decrypts off-chain
3. `getDecryptResultSafe()` reads the result once available

### Access Control Functions

```solidity
FHE.allowThis(d.buyerMax);    // Contract can use this value in future operations
FHE.allow(d.dealPrice, d.buyer);  // Buyer can unseal/decrypt this value
FHE.allowGlobal(d.isMatch);   // Anyone can access match result for finalization
```

Every encrypted value has an **Access Control List (ACL)**. Without `allowThis`, the contract can't use its own encrypted variables in subsequent transactions. Without `allow(value, address)`, that address can't decrypt the value via the SDK.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Client Layer                        │
│                                                          │
│  cofhejs SDK                                             │
│  ┌──────────────────┐   ┌────────────────────────────┐   │
│  │ cofhejs.encrypt  │   │ cofhejs.unseal             │   │
│  │ (plaintext → ZK  │   │ (ciphertext handle →       │   │
│  │ proven cipher)   │   │  plaintext, with permit)   │   │
│  └────────┬─────────┘   └─────────────▲──────────────┘   │
│           │                           │                  │
└───────────┼───────────────────────────┼──────────────────┘
            │ InEuint64                 │ euint64 handle
            ▼                           │
┌───────────────────────────────────────┼───────────────────┐
│              BlindDeal.sol            │                   │
│                                       │                   │
│  submitBuyerPrice(InEuint64) ─────────┤                   │
│  submitSellerPrice(InEuint64)         │                   │
│                                       │                   │
│  _resolve():                          │                   │
│    FHE.gte  → ebool                   │                   │
│    FHE.add  → euint64                 │                   │
│    FHE.div  → euint64                 │                   │
│    FHE.select → euint64               │                   │
│    FHE.decrypt(isMatch) ──────┐       │                   │
│                               │       │                   │
│  finalizeDeal():              │       │                   │
│    getDecryptResultSafe() ◄───┼───────┘                   │
│    FHE.allow(dealPrice,...) ──┼───► getDealPrice()        │
│                               │                           │
└───────────────────────────────┼───────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────┐
│                    CoFHE Coprocessor                      │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ TaskManager  │  │ FHEOS Server │  │ Threshold       │  │
│  │ (validates   │  │ (executes    │  │ Network         │  │
│  │  FHE ops,    │  │  FHE math    │  │ (MPC-based      │  │
│  │  manages     │  │  on cipher-  │  │  decryption)    │  │
│  │  ACL)        │  │  texts)      │  │                 │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│                                                           │
│  All computation happens on ciphertext — never plaintext  │
└───────────────────────────────────────────────────────────┘
```

---

## Live Deployments

### Frontend

| | |
|---|---|
| **Supported Chains** | Arbitrum Sepolia, Ethereum Sepolia |

### Smart Contracts

| Network | Contract Address | Explorer |
|---------|-----------------|----------|
| **Arbitrum Sepolia** | `0x6f7665a7aD14c5DAE617BFec7E80d616DA1Aab7A` | [View on Arbiscan](https://sepolia.arbiscan.io/address/0x6f7665a7aD14c5DAE617BFec7E80d616DA1Aab7A) |
| **Ethereum Sepolia** | `0x348e8E6Da1278a625B0B13Ff81a55D3AA614f4aD` | [View on Etherscan](https://sepolia.etherscan.io/address/0x348e8E6Da1278a625B0B13Ff81a55D3AA614f4aD) |

Deployer: `0x86E95581E41946ED84956433a8a9c836bCbA636c`

---

## Project Structure

```
blinddeal/
├── contracts/
│   └── BlindDeal.sol          # Core negotiation contract (~215 lines)
├── test/
│   └── BlindDeal.test.ts      # 22 tests covering all paths
├── tasks/
│   ├── deploy-blinddeal.ts    # Deploy to testnet
│   ├── create-deal.ts         # Create a new deal
│   ├── submit-price.ts        # Submit encrypted price (buyer or seller)
│   ├── finalize-deal.ts       # Finalize after Threshold Network decrypts
│   ├── utils.ts               # Deployment address persistence
│   └── index.ts               # Task registry
├── hardhat.config.ts          # Network config (Sepolia, Arb Sepolia)
├── package.json               # Scripts for all networks
└── README.md                  # This file
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

### Compile

```bash
pnpm compile
```

### Test (Local Mock Environment)

```bash
pnpm test
```

Expected output:

```
BlindDeal
  Deal Creation
    ✔ Should create a deal with buyer and seller
    ✔ Should increment deal count
  Price Submission
    ✔ Should allow buyer to submit encrypted price
    ✔ Should allow seller to submit encrypted price
    ✔ Should reject wrong role submitting
    ✔ Should reject double submission
  Deal Resolution — Match
    ✔ Should match when buyer max >= seller min (1000 >= 800)
    ✔ Should compute midpoint price correctly
    ✔ Should match when prices are equal
  Deal Resolution — No Match
    ✔ Should not match when buyer max < seller min (500 < 800)
    ✔ Should revert when reading price of unmatched deal
  Cancellation
    ✔ Should allow buyer to cancel before resolution
    ✔ Should allow seller to cancel before resolution
    ✔ Should reject cancellation from outsider
    ✔ Should reject submission on cancelled deal

15 passing
```

### Deploy to Testnet

1. Create `.env`:

```bash
PRIVATE_KEY=your_private_key_here
ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com
```

2. Deploy:

```bash
# Arbitrum Sepolia (recommended — lower gas)
pnpm arb-sepolia:deploy-blinddeal

# Ethereum Sepolia
pnpm eth-sepolia:deploy-blinddeal
```

---

## Usage — Hardhat Tasks

### Full Negotiation Flow

```bash
# 1. Deploy
npx hardhat deploy-blinddeal --network arb-sepolia

# 2. Buyer creates a deal
npx hardhat create-deal --network arb-sepolia \
  --seller 0xSellerAddress... \
  --description "Logo design project"

# 3. Buyer submits their max price (encrypted client-side)
npx hardhat submit-price --network arb-sepolia \
  --deal 0 --price 1000 --role buyer

# 4. Seller submits their min price (encrypted client-side)
npx hardhat submit-price --network arb-sepolia \
  --deal 0 --price 800 --role seller
# → "Both prices submitted — deal is resolving via FHE..."

# 5. Wait for Threshold Network, then finalize
npx hardhat finalize-deal --network arb-sepolia --deal 0
# → "Deal matched! Deal price: 900"
```

### Task Reference

| Task | Params | Description |
|------|--------|-------------|
| `deploy-blinddeal` | — | Deploy contract, save address |
| `create-deal` | `--seller <addr>` `--description <text>` `--duration <secs>` | Buyer initiates negotiation |
| `submit-price` | `--deal <id>` `--price <amount>` `--role buyer\|seller` | Submit encrypted price |
| `finalize-deal` | `--deal <id>` | Read decrypted match, transition state |

---

## Tests

The test suite (`test/BlindDeal.test.ts`) covers 22 scenarios across 6 categories:

| Category | Tests | What's verified |
|----------|-------|-----------------|
| **Deal Creation** | 5 | State init, ID increment, per-user tracking, deadline on/off |
| **Price Submission** | 4 | Encrypted input handling, role enforcement, double-submit prevention |
| **Match Resolution** | 3 | FHE comparison (match), midpoint arithmetic (900 from 1000/800), equal prices |
| **No Match** | 2 | FHE comparison (no match), price privacy (revert on getDealPrice) |
| **Cancellation** | 4 | Buyer cancel, seller cancel, outsider rejection, post-cancel submission rejection |
| **Deal Expiry** | 4 | Reject submission after deadline, expire by outsider, early expire rejection, no-deadline expire rejection |

Tests use the **mock FHE environment** (`cofhe-hardhat-plugin`) which simulates CoFHE operations locally with plaintext under the hood, allowing verification of FHE logic without a testnet.

---

## Supported Networks

| Network | Chain ID | Status | Gas Cost |
|---------|----------|--------|----------|
| Hardhat (mock) | 31337 | Development & testing | Simulated |
| Arbitrum Sepolia | 421614 | ✅ Deployed | Lower (L2) |
| Ethereum Sepolia | 11155111 | ✅ Deployed | Higher (L1) |

Faucets:
- [Alchemy Arbitrum Sepolia](https://www.alchemy.com/faucets/arbitrum-sepolia) — 0.1 ETH
- [Alchemy Sepolia](https://www.alchemy.com/faucets/ethereum-sepolia) — 0.5 ETH

---

## Roadmap

### Wave 1 — Ideation & Smart Contract Core (Mar 21–28) ✅

- [x] Problem definition: confidential negotiation on transparent chains
- [x] Privacy model design: what's encrypted, what's public, when disclosure happens
- [x] FHE operation selection: `gte`, `add`, `div`, `select`, `decrypt` — 6 operations
- [x] `BlindDeal.sol` — working encrypted negotiation contract (~215 lines)
- [x] ACL-based access control: only matched parties can unseal the deal price
- [x] Deal deadlines: auto-expiry for unresponsive counterparties
- [x] Per-user deal tracking: `getUserDeals(address)` for frontend discoverability
- [x] Hardhat deploy + interaction tasks (deploy, create-deal, submit-price, finalize-deal)
- [x] 22/22 test coverage (creation, submission, match, no-match, cancel, deadline expiry)
- [x] Deployed to Arbitrum Sepolia and Ethereum Sepolia
- [x] Full documentation: architecture, FHE deep dive, privacy model, roadmap

### Wave 2 — Frontend + Escrow Settlement (Mar 30–Apr 6) ✅

- [x] Vite + React 18 + TypeScript + Tailwind CSS frontend with `@cofhe/react` hooks
- [x] Wagmi wallet connection + multi-chain routing (Arbitrum Sepolia + Ethereum Sepolia)
- [x] Full deal lifecycle UI: create, submit encrypted prices, finalize, cancel, expire
- [x] FHE price unsealing via `cofheClient.decryptForView()` with auto-permits
- [x] `@reineira-os/sdk` escrow settlement: create → fund (USDC) → redeem
- [x] End-to-end testnet flow working + deployed on Vercel

### Wave 3 — Telegram Bot + Notifications (Apr 8–Apr 20)

- [ ] Telegram Bot (`grammy` / `telegraf`) — notify participants on deal events
- [ ] Webhook listener: `PriceSubmitted`, `DealResolving`, `DealResolved` events → Telegram DM
- [ ] Push notification service: browser push for deal state changes
- [ ] Deal share links: generate invite URL for seller counterparty

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
- [ ] Contract verification on Arbiscan / Etherscan
- [ ] Landing page with protocol explanation
- [ ] Security review against FHE-specific patterns

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **FHE Smart Contracts** | Solidity 0.8.25, `@fhenixprotocol/cofhe-contracts` |
| **FHE Coprocessor** | Fhenix CoFHE (TaskManager, FHEOS, Threshold Network) |
| **Client SDK** | `cofhejs` (encrypt, unseal, permits) |
| **Dev Framework** | Hardhat 2.22, `cofhe-hardhat-plugin` (mock FHE) |
| **Testing** | Mocha, Chai, `@nomicfoundation/hardhat-toolbox` |
| **Settlement** | `@reineira-os/sdk` (escrow create, fund, redeem) |
| **Frontend** | Vite + React 18, `@cofhe/react`, wagmi, Tailwind CSS |
| **Networks** | Arbitrum Sepolia, Ethereum Sepolia, Base Sepolia |

---

## License

MIT

### Environment Configuration

The plugin supports different environments:

- `MOCK`: For testing with mocked FHE operations
- `LOCAL`: For testing with a local CoFHE network (whitelist only)
- `TESTNET`: For testing and tasks using `arb-sepolia` and `eth-sepolia`

You can check the current environment using:

```typescript
if (!isPermittedCofheEnvironment(hre, 'MOCK')) {
	// Skip test or handle accordingly
}
```

## Links and Additional Resources

### `cofhejs`

[`cofhejs`](https://github.com/FhenixProtocol/cofhejs) is the JavaScript/TypeScript library for interacting with FHE smart contracts. It provides functions for encryption, decryption, and unsealing FHE values.

#### Key Features

- Encryption of data before sending to FHE contracts
- Unsealing encrypted values from contracts
- Managing permits for secure contract interactions
- Integration with Web3 libraries (ethers.js and viem)

### `cofhe-mock-contracts`

[`cofhe-mock-contracts`](https://github.com/FhenixProtocol/cofhe-mock-contracts) provides mock implementations of CoFHE contracts for testing FHE functionality without the actual coprocessor.

#### Features

- Mock implementations of core CoFHE contracts:
  - MockTaskManager
  - MockQueryDecrypter
  - MockZkVerifier
  - ACL (Access Control List)
- Synchronous operation simulation with mock delays
- On-chain access to unencrypted values for testing

#### Integration with Hardhat and cofhejs

Both `cofhejs` and `cofhe-hardhat-plugin` interact directly with the mock contracts:

- When imported in `hardhat.config.ts`, `cofhe-hardhat-plugin` injects necessary mock contracts into the Hardhat testnet
- `cofhejs` automatically detects mock contracts and adjusts behavior for test environments

#### Mock Behavior Differences

- **Symbolic Execution**: In mocks, ciphertext hashes point to plaintext values stored on-chain
- **On-chain Decryption**: Mock decryption adds simulated delays to mimic real behavior
- **ZK Verification**: Mock verifier handles on-chain storage of encrypted inputs
- **Off-chain Decryption**: When using `cofhejs.unseal()`, mocks return plaintext values directly from on-chain storage

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
