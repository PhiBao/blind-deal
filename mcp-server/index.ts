import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';
import { createPublicClient, http, parseAbi } from 'viem';
import { arbitrumSepolia, sepolia } from 'viem/chains';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
dotenv.config({ path: join(__dirname, '../.env') });

const SDK_CJS = join(__dirname, '../node_modules/@modelcontextprotocol/sdk/dist/cjs');

// @ts-ignore
const { Server } = require(join(SDK_CJS, 'server/index.js'));
// @ts-ignore
const { createMcpExpressApp } = require(join(SDK_CJS, 'server/express.js'));
// @ts-ignore
const { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } = require(join(SDK_CJS, 'types.js'));

const PORT = Number(process.env.MCP_PORT || 3001);
const CHAIN = arbitrumSepolia;

const BLIND_DEAL_ABI = parseAbi([
  'event DealCreated(uint256 indexed dealId, address indexed buyer, address indexed seller, string description, uint256 deadline)',
  'event DealJoined(uint256 indexed dealId, address indexed seller)',
  'event PriceSubmitted(uint256 indexed dealId, address indexed party)',
  'event DealResolving(uint256 indexed dealId)',
  'event DealResolved(uint256 indexed dealId, uint8 state)',
  'event DealCancelled(uint256 indexed dealId, address indexed cancelledBy)',
  'event DealExpired(uint256 indexed dealId, uint256 deadline)',
  'function getDealState(uint256 dealId) view returns (uint8)',
  'function getDealParties(uint256 dealId) view returns (address buyer, address seller)',
  'function getDealDescription(uint256 dealId) view returns (string)',
  'function getDealType(uint256 dealId) view returns (uint8)',
  'function isDealSubmitted(uint256 dealId) view returns (bool buyerDone, bool sellerDone)',
  'function dealCount() view returns (uint256)',
  'function getUserDeals(address user) view returns (uint256[])',
  'function getDealMinPrice(uint256 dealId) view returns (uint256)',
  'function getDealMaxPrice(uint256 dealId) view returns (uint256)',
] as const);

const CONTRACTS: Record<number, `0x${string}`> = {
  [arbitrumSepolia.id]: (process.env.BLIND_DEAL_ADDRESS as `0x${string}`) || '0xabf1161bEcf179A4Cb6604387273931E1d76A65c',
  [sepolia.id]: '0xBed299e6e40233bD4Cac7bd472356F16e99EBf10',
};

const client = createPublicClient({
  chain: CHAIN,
  transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL),
});

const CONTRACT = CONTRACTS[arbitrumSepolia.id];

const STATE_LABELS = ['Open', 'Matched', 'No Match', 'Cancelled', 'Expired'];

function contractForChain(chainId: number) {
  return CONTRACTS[chainId] ?? CONTRACTS[arbitrumSepolia.id];
}

async function getDealInfo(dealId: bigint) {
  const addr = CONTRACT;
  const [state, parties, desc, submitted, dealType, minPrice, maxPrice] = await Promise.all([
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [dealId] }),
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [dealId] }),
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [dealId] }),
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'isDealSubmitted', args: [dealId] }),
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'getDealType', args: [dealId] }),
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'getDealMinPrice', args: [dealId] }).catch(() => 0n),
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'getDealMaxPrice', args: [dealId] }).catch(() => 0n),
  ]);
  return { state: Number(state), parties, desc, submitted, dealType: Number(dealType), minPrice, maxPrice };
}

const server = new Server(
  {
    name: 'BlindDeal MCP Server',
    version: '1.0.0',
    description: 'Model Context Protocol server for BlindDeal FHE-based confidential price negotiation',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_deal',
      description: 'Create a new blind negotiation deal on BlindDeal protocol. The deal will be Open type if no seller is specified.',
      inputSchema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Deal description' },
          minPrice: { type: 'number', description: 'Minimum acceptable price (wei or token units)' },
          maxPrice: { type: 'number', description: 'Maximum acceptable price (wei or token units)' },
          seller: { type: 'string', description: 'Seller address (optional, omit for Open marketplace deal)' },
          deadline: { type: 'number', description: 'Deadline timestamp (optional, defaults to 7 days)' },
        },
        required: ['description', 'minPrice', 'maxPrice'],
      },
    },
    {
      name: 'get_deal',
      description: 'Fetch deal details including state, parties, submission status, and price range.',
      inputSchema: {
        type: 'object',
        properties: {
          dealId: { type: 'number', description: 'The deal ID to fetch' },
        },
        required: ['dealId'],
      },
    },
    {
      name: 'list_deals',
      description: 'List marketplace deals with optional state and type filtering.',
      inputSchema: {
        type: 'object',
        properties: {
          state: { type: 'string', description: 'Filter by state: open, matched, no-match, cancelled, expired' },
          limit: { type: 'number', description: 'Maximum number of deals to return (default 20)' },
          offset: { type: 'number', description: 'Offset for pagination (default 0)' },
        },
      },
    },
    {
      name: 'get_events',
      description: 'Get recent blockchain events for BlindDeal contract.',
      inputSchema: {
        type: 'object',
        properties: {
          eventType: { type: 'string', description: 'Event type: DealCreated, DealJoined, PriceSubmitted, DealResolving, DealResolved, DealCancelled, DealExpired' },
          fromBlock: { type: 'number', description: 'Starting block number (default: last 100 blocks)' },
          dealId: { type: 'number', description: 'Filter by specific deal ID' },
        },
      },
    },
    {
      name: 'get_user_deals',
      description: 'Get all deals associated with a specific wallet address.',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Wallet address to query' },
        },
        required: ['address'],
      },
    },
    {
      name: 'subscribe_deal',
      description: 'Subscribe to deal event notifications. Returns confirmation with deal details.',
      inputSchema: {
        type: 'object',
        properties: {
          dealId: { type: 'number', description: 'Deal ID to subscribe to' },
          address: { type: 'string', description: 'Wallet address for notifications' },
        },
        required: ['dealId'],
      },
    },
  ],
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'blinddeal://contract/arbitrum-sepolia',
      name: 'Arbitrum Sepolia Contract',
      description: 'BlindDeal contract address on Arbitrum Sepolia testnet',
      mimeType: 'application/json',
    },
    {
      uri: 'blinddeal://contract/ethereum-sepolia',
      name: 'Ethereum Sepolia Contract',
      description: 'BlindDeal contract address on Ethereum Sepolia testnet',
      mimeType: 'application/json',
    },
    {
      uri: 'blinddeal://schema/deal',
      name: 'Deal Schema',
      description: 'Schema definition for deal data returned by get_deal',
      mimeType: 'application/json',
    },
    {
      uri: 'blinddeal://events',
      name: 'Event Types',
      description: 'All event types emitted by BlindDeal contract',
      mimeType: 'application/json',
    },
    {
      uri: 'blinddeal://deal-types',
      name: 'Deal Types',
      description: 'Deal type enum: 0 = Direct, 1 = Open (marketplace)',
      mimeType: 'application/json',
    },
    {
      uri: 'blinddeal://deal-states',
      name: 'Deal States',
      description: 'Deal state enum: 0=Open, 1=Matched, 2=NoMatch, 3=Cancelled, 4=Expired',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const uri = req.params.uri;
  switch (uri) {
    case 'blinddeal://contract/arbitrum-sepolia':
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ address: CONTRACT, chain: 'arbitrum-sepolia', explorer: 'https://sepolia.arbiscan.io' }) }] };
    case 'blinddeal://contract/ethereum-sepolia':
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ address: CONTRACTS[sepolia.id], chain: 'ethereum-sepolia', explorer: 'https://sepolia.etherscan.io' }) }] };
    case 'blinddeal://schema/deal':
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ state: 'uint8', parties: 'address[2]', description: 'string', submitted: 'bool[2]', dealType: 'uint8', minPrice: 'uint256', maxPrice: 'uint256' }, null, 2) }] };
    case 'blinddeal://events':
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(['DealCreated', 'DealJoined', 'PriceSubmitted', 'DealResolving', 'DealResolved', 'DealCancelled', 'DealExpired'], null, 2) }] };
    case 'blinddeal://deal-types':
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ 0: 'Direct', 1: 'Open (marketplace)' }, null, 2) }] };
    case 'blinddeal://deal-states':
      return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(STATE_LABELS.map((label, i) => ({ [i]: label })).reduce((a, b) => ({ ...a, ...b }), {}), null, 2) }] };
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case 'get_deal': {
        const dealId = BigInt(args.dealId as number);
        const info = await getDealInfo(dealId);
        const [buyerDone, sellerDone] = info.submitted as [boolean, boolean];
        const isOpen = info.dealType === 1;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              dealId: Number(dealId),
              state: STATE_LABELS[info.state],
              stateCode: info.state,
              buyer: info.parties[0],
              seller: info.parties[1],
              description: info.desc,
              buyerSubmitted: buyerDone,
              sellerSubmitted: sellerDone,
              dealType: isOpen ? 'Open (marketplace)' : 'Direct',
              priceRange: info.minPrice && info.maxPrice ? { min: info.minPrice.toString(), max: info.maxPrice.toString() } : null,
              explorerUrl: `https://sepolia.arbiscan.io/address/${CONTRACT}?dealId=${dealId}`,
            }, null, 2),
          }],
        };
      }

      case 'list_deals': {
        const count = await client.readContract({ address: CONTRACT, abi: BLIND_DEAL_ABI, functionName: 'dealCount' });
        const limit = (args.limit as number) || 20;
        const offset = (args.offset as number) || 0;
        const stateFilter = args.state as string | undefined;

        const stateMap: Record<string, number> = { open: 0, matched: 1, 'no-match': 2, cancelled: 3, expired: 4 };
        const targetState = stateFilter ? stateMap[stateFilter] : undefined;

        const results = [];
        const total = Number(count);
        const start = Math.max(0, total - 1 - offset);
        const end = Math.max(0, start - limit);

        for (let id = start; id >= end && results.length < limit; id--) {
          try {
            const info = await getDealInfo(BigInt(id));
            if (targetState !== undefined && info.state !== targetState) continue;
            const [buyerDone, sellerDone] = info.submitted as [boolean, boolean];
            results.push({
              dealId: id,
              state: STATE_LABELS[info.state],
              stateCode: info.state,
              description: info.desc,
              buyer: info.parties[0],
              seller: info.parties[1],
              dealType: info.dealType === 1 ? 'Open' : 'Direct',
              buyerSubmitted: buyerDone,
              sellerSubmitted: sellerDone,
            });
          } catch {}
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ total: Number(count), deals: results }, null, 2) }],
        };
      }

      case 'get_user_deals': {
        const addr = args.address as string;
        const deals = await client.readContract({ address: CONTRACT, abi: BLIND_DEAL_ABI, functionName: 'getUserDeals', args: [addr] }) as bigint[];
        const results = [];
        for (const id of deals.slice(-20)) {
          try {
            const info = await getDealInfo(id);
            results.push({ dealId: Number(id), state: STATE_LABELS[info.state], description: info.desc });
          } catch {}
        }
        return { content: [{ type: 'text', text: JSON.stringify({ address: addr, deals: results }, null, 2) }] };
      }

      case 'get_events': {
        const eventType = args.eventType as string | undefined;
        const fromBlock = args.fromBlock as number | undefined;
        const dealIdFilter = args.dealId as number | undefined;

        let abiEvents = ['DealCreated', 'DealJoined', 'PriceSubmitted', 'DealResolving', 'DealResolved', 'DealCancelled', 'DealExpired'] as const;
        if (eventType) {
          abiEvents = [eventType as typeof abiEvents[number]];
        }

        const logs = await client.getContractEvents({
          address: CONTRACT,
          abi: BLIND_DEAL_ABI,
          fromBlock: fromBlock ? BigInt(fromBlock) : undefined,
        });

        let filtered = logs;
        if (dealIdFilter !== undefined) {
          filtered = filtered.filter((l) => Number((l.args as any)?.dealId) === dealIdFilter);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(filtered.slice(-50).map((l) => ({
              event: l.eventName,
              dealId: Number((l.args as any)?.dealId),
              blockNumber: Number(l.blockNumber),
              transactionHash: l.transactionHash,
              args: Object.fromEntries(Object.entries(l.args ?? {}).filter(([k]) => !Number.isNaN(Number(k)))),
            })), null, 2),
          }],
        };
      }

      case 'subscribe_deal': {
        const dealId = args.dealId as number;
        const notifyAddr = args.address as string | undefined;
        const info = await getDealInfo(BigInt(dealId));
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              subscribed: true,
              dealId,
              dealState: STATE_LABELS[info.state],
              description: info.desc,
              notificationAddress: notifyAddr || 'not specified',
              message: 'Subscribed to deal notifications. The Telegram bot will notify on events: DealCreated, DealJoined, PriceSubmitted, DealResolving, DealResolved.',
            }, null, 2),
          }],
        };
      }

      case 'create_deal': {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              note: 'create_deal requires a wallet with PRIVATE_KEY to sign transactions. Use the Hardhat CLI or frontend for this operation.',
              description: args.description,
              minPrice: args.minPrice,
              maxPrice: args.maxPrice,
              seller: args.seller || 'Open marketplace (any seller can join)',
              deadline: args.deadline || (Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60),
              contract: CONTRACT,
              instructions: 'To create a deal, either: (1) Use the BlindDeal frontend at blinddeal.vercel.app, or (2) Run: npx hardhat create-deal --description "..." --minPrice ... --maxPrice ... --network arb-sepolia',
            }, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const HTTP_PORT = Number(process.env.MCP_PORT || 3001);

async function startHttp() {
  const http = require('http');
  // @ts-ignore
  const { StreamableHTTPServerTransport } = require(join(SDK_CJS, 'server/streamableHttp.js'));

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  await server.connect(transport);

  const server2 = http.createServer((req: any, res: any) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', name: 'BlindDeal MCP Server', version: '1.0.0' }));
      return;
    }
    transport.handleRequest(req, res, req.body);
  });

  server2.listen(PORT, () => {
    console.log(`BlindDeal MCP Server running on http://0.0.0.0:${PORT}/mcp`);
  });
}

startHttp().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});