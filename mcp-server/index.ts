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

const HTTP_PORT = Number(process.env.MCP_PORT || 3001);

async function startHttp() {
  const http = require('http');

  // Raw JSON-RPC handler — avoids SDK Streamable HTTP stateless mode bugs
  const server2 = http.createServer(async (req: any, res: any) => {
    // Health check
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', name: 'BlindDeal MCP Server', version: '1.0.0' }));
      return;
    }

    // Only handle POST /mcp for JSON-RPC
    if (req.method !== 'POST' || (req.url !== '/mcp' && req.url !== '/')) {
      res.writeHead(404);
      res.end();
      return;
    }

    // Read body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();

    let rpc: any;
    try { rpc = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
      return;
    }

    const id = rpc.id ?? null;
    const respond = (result: any) => {
      const data = JSON.stringify({ jsonrpc: '2.0', result, id });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.end(`event: message\ndata: ${data}\n\n`);
    };
    const respondError = (code: number, message: string) => {
      const data = JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.end(`event: message\ndata: ${data}\n\n`);
    };

    try {
      const method = rpc.method;
      const params = rpc.params ?? {};

      switch (method) {
        // ── tools/list ──────────────────────────────────────
        case 'tools/list':
          return respond({
            tools: [
              {
                name: 'get_deal',
                description: 'Fetch deal details including state, parties, submission status, and price range.',
                inputSchema: { type: 'object', properties: { dealId: { type: 'number', description: 'The deal ID' } }, required: ['dealId'] },
              },
              {
                name: 'list_deals',
                description: 'List marketplace deals with optional state and type filtering.',
                inputSchema: { type: 'object', properties: { state: { type: 'string', description: 'Filter: open, matched, no-match, cancelled, expired' }, limit: { type: 'number' }, offset: { type: 'number' } } },
              },
              {
                name: 'get_user_deals',
                description: 'Get all deals for a wallet address.',
                inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'] },
              },
              {
                name: 'get_events',
                description: 'Fetch recent contract events.',
                inputSchema: { type: 'object', properties: { eventType: { type: 'string' }, fromBlock: { type: 'number' }, dealId: { type: 'number' } } },
              },
              {
                name: 'subscribe_deal',
                description: 'Subscribe to deal event notifications.',
                inputSchema: { type: 'object', properties: { dealId: { type: 'number' }, address: { type: 'string' } }, required: ['dealId'] },
              },
              {
                name: 'create_deal',
                description: 'Create a new deal (info only — requires wallet for on-chain tx).',
                inputSchema: { type: 'object', properties: { description: { type: 'string' }, minPrice: { type: 'number' }, maxPrice: { type: 'number' }, seller: { type: 'string' }, deadline: { type: 'number' } }, required: ['description', 'minPrice', 'maxPrice'] },
              },
            ],
          });

        // ── resources/list ───────────────────────────────────
        case 'resources/list':
          return respond({
            resources: [
              { uri: 'blinddeal://contract/arbitrum-sepolia', name: 'Arbitrum Sepolia Contract', description: 'BlindDeal contract on Arbitrum Sepolia', mimeType: 'application/json' },
              { uri: 'blinddeal://contract/ethereum-sepolia', name: 'Ethereum Sepolia Contract', description: 'BlindDeal contract on Ethereum Sepolia', mimeType: 'application/json' },
              { uri: 'blinddeal://schema/deal', name: 'Deal Schema', description: 'Deal data schema', mimeType: 'application/json' },
              { uri: 'blinddeal://events', name: 'Event Types', description: 'All BlindDeal event types', mimeType: 'application/json' },
              { uri: 'blinddeal://deal-types', name: 'Deal Types', description: '0=Direct, 1=Open (marketplace)', mimeType: 'application/json' },
              { uri: 'blinddeal://deal-states', name: 'Deal States', description: '0=Open, 1=Matched, 2=NoMatch, 3=Cancelled, 4=Expired', mimeType: 'application/json' },
            ],
          });

        // ── resources/read ───────────────────────────────────
        case 'resources/read': {
          const uri = params.uri as string;
          const resourceMap: Record<string, any> = {
            'blinddeal://contract/arbitrum-sepolia': { address: CONTRACT, chain: 'arbitrum-sepolia', explorer: 'https://sepolia.arbiscan.io' },
            'blinddeal://contract/ethereum-sepolia': { address: CONTRACTS[sepolia.id], chain: 'ethereum-sepolia', explorer: 'https://sepolia.etherscan.io' },
            'blinddeal://schema/deal': { state: 'uint8', parties: 'address[2]', description: 'string', submitted: 'bool[2]', dealType: 'uint8', minPrice: 'uint256', maxPrice: 'uint256' },
            'blinddeal://events': ['DealCreated', 'DealJoined', 'PriceSubmitted', 'DealResolving', 'DealResolved', 'DealCancelled', 'DealExpired'],
            'blinddeal://deal-types': { 0: 'Direct', 1: 'Open (marketplace)' },
            'blinddeal://deal-states': { 0: 'Open', 1: 'Matched', 2: 'No Match', 3: 'Cancelled', 4: 'Expired' },
          };
          const data = resourceMap[uri];
          if (!data) return respondError(-32602, `Unknown resource: ${uri}`);
          return respond({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }] });
        }

        // ── tools/call ───────────────────────────────────────
        case 'tools/call': {
          const toolName = params.name as string;
          const args = (params.arguments ?? {}) as Record<string, any>;

          switch (toolName) {
            case 'get_deal': {
              const dealId = BigInt(args.dealId as number);
              const info = await getDealInfo(dealId);
              const [buyerDone, sellerDone] = info.submitted as [boolean, boolean];
              return respond({
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
                    dealType: info.dealType === 1 ? 'Open (marketplace)' : 'Direct',
                    priceRange: info.minPrice && info.maxPrice ? { min: info.minPrice.toString(), max: info.maxPrice.toString() } : null,
                    explorerUrl: `https://sepolia.arbiscan.io/address/${CONTRACT}`,
                  }, null, 2),
                }],
              });
            }

            case 'list_deals': {
              const count = await client.readContract({ address: CONTRACT, abi: BLIND_DEAL_ABI, functionName: 'dealCount' });
              const limit = (args.limit as number) || 20;
              const offset = (args.offset as number) || 0;
              const stateFilter = args.state as string | undefined;
              const stateMap: Record<string, number> = { open: 0, matched: 1, 'no-match': 2, cancelled: 3, expired: 4 };
              const targetState = stateFilter ? stateMap[stateFilter] : undefined;
              const results: any[] = [];
              const total = Number(count);
              const start = Math.max(0, total - 1 - offset);
              const end = Math.max(0, start - limit);
              for (let id = start; id >= end && results.length < limit; id--) {
                try {
                  const info = await getDealInfo(BigInt(id));
                  if (targetState !== undefined && info.state !== targetState) continue;
                  const [buyerDone, sellerDone] = info.submitted as [boolean, boolean];
                  results.push({ dealId: id, state: STATE_LABELS[info.state], stateCode: info.state, description: info.desc, buyer: info.parties[0], seller: info.parties[1], dealType: info.dealType === 1 ? 'Open' : 'Direct', buyerSubmitted: buyerDone, sellerSubmitted: sellerDone });
                } catch {}
              }
              return respond({ content: [{ type: 'text', text: JSON.stringify({ total: Number(count), deals: results }, null, 2) }] });
            }

            case 'get_user_deals': {
              const addr = args.address as string;
              const deals = await client.readContract({ address: CONTRACT, abi: BLIND_DEAL_ABI, functionName: 'getUserDeals', args: [addr] }) as bigint[];
              const dealResults = [];
              for (const id of deals.slice(-20)) {
                try {
                  const info = await getDealInfo(id);
                  dealResults.push({ dealId: Number(id), state: STATE_LABELS[info.state], description: info.desc });
                } catch {}
              }
              return respond({ content: [{ type: 'text', text: JSON.stringify({ address: addr, deals: dealResults }, null, 2) }] });
            }

            case 'get_events': {
              const eventType = args.eventType as string | undefined;
              const fromBlock = args.fromBlock as number | undefined;
              const dealIdFilter = args.dealId as number | undefined;
              const fromBlockNum = fromBlock !== undefined ? BigInt(fromBlock) : (await client.getBlockNumber()) - 1000n;
              const logs = await client.getContractEvents({ address: CONTRACT, abi: BLIND_DEAL_ABI, fromBlock: fromBlockNum });
              let filtered = logs;
              if (dealIdFilter !== undefined) filtered = filtered.filter((l: any) => Number(l.args?.dealId) === dealIdFilter);
              return respond({
                content: [{ type: 'text', text: JSON.stringify(filtered.slice(-50).map((l: any) => ({
                  event: l.eventName, dealId: Number(l.args?.dealId), blockNumber: Number(l.blockNumber), transactionHash: l.transactionHash,
                })), null, 2) }],
              });
            }

            case 'subscribe_deal': {
              const dealId2 = args.dealId as number;
              const info = await getDealInfo(BigInt(dealId2));
              return respond({
                content: [{ type: 'text', text: JSON.stringify({
                  subscribed: true, dealId: dealId2, dealState: STATE_LABELS[info.state], description: info.desc,
                  message: 'Subscribed to deal notifications.',
                }, null, 2) }],
              });
            }

            case 'create_deal': {
              return respond({
                content: [{ type: 'text', text: JSON.stringify({
                  note: 'create_deal requires a wallet. Use the frontend or Hardhat CLI.',
                  description: args.description, minPrice: args.minPrice, maxPrice: args.maxPrice,
                  seller: args.seller || 'Open marketplace', contract: CONTRACT,
                }, null, 2) }],
              });
            }

            default:
              return respondError(-32601, `Unknown tool: ${toolName}`);
          }
        }

        // ── Notifications (ping, etc.) ────────────────────────
        case 'notifications/initialized':
          return respond({});

        default:
          return respondError(-32601, `Method not found: ${method}`);
      }
    } catch (err: any) {
      console.error('[MCP] Handler error:', err?.message || err);
      return respondError(-32603, err?.message || 'Internal error');
    }
  });

  function tryListen(retries = 5, delay = 2000) {
    server2.listen(PORT, () => {
      console.log(`BlindDeal MCP Server running on http://0.0.0.0:${PORT}/mcp`);
    });
    server2.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE' && retries > 0) {
        console.log(`Port ${PORT} in use — retrying in ${delay}ms (${retries} tries left)`);
        server2.close();
        setTimeout(() => tryListen(retries - 1, delay), delay);
      } else {
        console.error(`Failed to bind port ${PORT}:`, err.message);
        process.exit(1);
      }
    });
  }
  tryListen();
}

startHttp().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
