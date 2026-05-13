import { Telegraf, Markup } from 'telegraf';
import { createPublicClient, http, parseAbi } from 'viem';
import { arbitrumSepolia, sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required in .env');
  process.exit(1);
}

// ── Contract config (v5) ──────────────────────────────────────────

const BLIND_DEAL_ABI = parseAbi([
  'event DealCreated(uint256 indexed dealId, address indexed buyer, address indexed seller, string description, uint256 deadline)',
  'event PriceSubmitted(uint256 indexed dealId, address indexed party)',
  'event DealJoined(uint256 indexed dealId, address indexed seller)',
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
] as const);

const CONTRACTS: Record<number, `0x${string}`> = {
  [arbitrumSepolia.id]: '0x3254538efD1F186640daf059C6Ff35a08bf33995',
  [sepolia.id]: '0x36a155431C4525CEEdEB73A461372fB127A0Bd49',
};

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://blind-deal.vercel.app';
const BOT_USERNAME = process.env.VITE_TELEGRAM_BOT_USERNAME || 'BlindDealBot';

const STATE_LABELS = ['Open', 'Matched', 'No Match', 'Cancelled', 'Expired'];

// ── Viem clients ────────────────────────────────────────────────

const arbClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(process.env.VITE_ARBITRUM_SEPOLIA_RPC_URL),
});

const ethClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.VITE_SEPOLIA_RPC_URL),
});

function getClient(chainId: number) {
  return chainId === arbitrumSepolia.id ? arbClient : ethClient;
}

function getContractAddress(chainId: number) {
  return CONTRACTS[chainId] ?? CONTRACTS[arbitrumSepolia.id];
}

// ── Subscription store ──────────────────────────────────────────

const SUBS_FILE = path.join(__dirname, '.subscriptions.json');

type Subscriptions = Record<string, number[]>; // chatId -> dealIds[]

function loadSubs(): Subscriptions {
  try {
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSubs(subs: Subscriptions) {
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

let subscriptions = loadSubs();

function subscribe(chatId: string, dealId: number) {
  if (!subscriptions[chatId]) subscriptions[chatId] = [];
  if (!subscriptions[chatId].includes(dealId)) {
    subscriptions[chatId].push(dealId);
    saveSubs(subscriptions);
  }
}

function unsubscribe(chatId: string, dealId: number) {
  if (!subscriptions[chatId]) return;
  subscriptions[chatId] = subscriptions[chatId].filter((id) => id !== dealId);
  if (subscriptions[chatId].length === 0) delete subscriptions[chatId];
  saveSubs(subscriptions);
}

// ── Helpers ─────────────────────────────────────────────────────

function dealUrl(dealId: number, action?: string) {
  let url = `${FRONTEND_URL}?deal=${dealId}&chain=${arbitrumSepolia.id}`;
  if (action) url += `&action=${action}`;
  return url;
}

async function readDealInfo(dealId: number) {
  const client = arbClient;
  const addr = CONTRACTS[arbitrumSepolia.id];
  console.log(`[Telegram] Reading deal ${dealId} from ${addr}`);
  const [state, parties, desc, submitted] = await Promise.all([
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [BigInt(dealId)] }),
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [BigInt(dealId)] }),
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [BigInt(dealId)] }),
    client.readContract({ address: addr, abi: BLIND_DEAL_ABI, functionName: 'isDealSubmitted', args: [BigInt(dealId)] }),
  ]);
  return { state, parties, desc, submitted };
}

// ── Bot ─────────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply(
    `🔐 *Welcome to BlindDeal Bot*\n\n` +
      `Confidential P2P price negotiation powered by FHE.\n\n` +
      `*Commands:*\n` +
      `/list — Browse open deals\n` +
      `/status <dealId> — Check deal status\n` +
      `/share <dealId> — Get a shareable link\n` +
      `/create — Open the deal creation page\n` +
      `/submit <dealId> — Open the submit price page\n` +
      `/subscribe <dealId> — Get notified on updates\n` +
      `/unsubscribe <dealId> — Stop notifications\n` +
      `/help — Show this message`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('help', (ctx) => {
  ctx.reply(
    '🔐 *BlindDeal Commands*\n\n' +
      '/list — Browse open deals on the marketplace\n' +
      '/status <dealId> — View deal details, state, and participants\n' +
      '/share <dealId> — Get a shareable link to a deal\n' +
      '/create — Open BlindDeal to create a new deal\n' +
      '/submit <dealId> — Open BlindDeal to submit your encrypted price\n' +
      '/subscribe <dealId> — Subscribe to deal notifications\n' +
      '/unsubscribe <dealId> — Unsubscribe from a deal\n' +
      '/subscriptions — List your active subscriptions',
    { parse_mode: 'Markdown' }
  );
});

bot.command('list', async (ctx) => {
  try {
    console.log(`[Telegram] /list from ${ctx.chat.id}`);
    const count = await arbClient.readContract({
      address: CONTRACTS[arbitrumSepolia.id],
      abi: BLIND_DEAL_ABI,
      functionName: 'dealCount',
    });

    const total = Number(count);
    console.log(`[Telegram] dealCount = ${total}`);
    if (total === 0) {
      return ctx.reply('No deals yet. Be the first to /create one!');
    }

    // Fetch last 10 deals and filter for open ones
    const startId = Math.max(0, total - 1);
    const limit = Math.min(total, 20);
    const ids = Array.from({ length: limit }, (_, i) => startId - i);

    const results = await Promise.allSettled(
      ids.map(async (id) => {
        const [state, parties, desc, submitted, dealType] = await Promise.all([
          arbClient.readContract({ address: CONTRACTS[arbitrumSepolia.id], abi: BLIND_DEAL_ABI, functionName: 'getDealState', args: [BigInt(id)] }),
          arbClient.readContract({ address: CONTRACTS[arbitrumSepolia.id], abi: BLIND_DEAL_ABI, functionName: 'getDealParties', args: [BigInt(id)] }),
          arbClient.readContract({ address: CONTRACTS[arbitrumSepolia.id], abi: BLIND_DEAL_ABI, functionName: 'getDealDescription', args: [BigInt(id)] }),
          arbClient.readContract({ address: CONTRACTS[arbitrumSepolia.id], abi: BLIND_DEAL_ABI, functionName: 'isDealSubmitted', args: [BigInt(id)] }),
          arbClient.readContract({ address: CONTRACTS[arbitrumSepolia.id], abi: BLIND_DEAL_ABI, functionName: 'getDealType', args: [BigInt(id)] }),
        ]);
        return { id, state, parties, desc, submitted, dealType };
      })
    );

    const openDeals = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof readDealInfo>> & { id: number; dealType: number }> =>
        r.status === 'fulfilled' && r.value.state === 0
      )
      .map((r) => r.value);

    if (openDeals.length === 0) {
      console.log(`[Telegram] /list -> 0 open deals out of ${total} total`);
      return ctx.reply('No open deals found. Be the first to /create one!');
    }

    console.log(`[Telegram] /list -> ${openDeals.length} open deals`);

    const lines = openDeals.map((d) => {
      const [buyerDone, sellerDone] = d.submitted;
      const isOpen = d.dealType === 1 && d.parties[1] === '0x0000000000000000000000000000000000000000';
      const priceInfo = buyerDone && sellerDone ? '✅ Both submitted' : buyerDone ? '⏳ Buyer done' : sellerDone ? '⏳ Seller done' : isOpen ? '🏪 Open for sellers' : '⏳ Waiting';
      return `• *Deal #${d.id}* — ${d.desc.slice(0, 40)}${d.desc.length > 40 ? '...' : ''}\n  ${priceInfo}`;
    });

    // Separate into joinable and regular open deals
    const joinableDeals = openDeals.filter((d) => d.dealType === 1 && d.parties[1] === '0x0000000000000000000000000000000000000000');

    const keyboard = joinableDeals.length > 0
      ? [
          joinableDeals.slice(0, 3).map((d) =>
            Markup.button.url(`Join #${d.id}`, dealUrl(d.id))
          ),
          openDeals.filter((d) => !(d.dealType === 1 && d.parties[1] === '0x0000000000000000000000000000000000000000')).slice(0, 5).map((d) =>
            Markup.button.url(`#${d.id}`, dealUrl(d.id))
          ),
        ]
      : [
          openDeals.slice(0, 5).map((d) =>
            Markup.button.url(`#${d.id}`, dealUrl(d.id))
          ),
        ];

    ctx.reply(
      `🏪 *Open Deals (${openDeals.length})*\n\n${lines.join('\n\n')}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(keyboard.filter((row) => row.length > 0)),
      }
    );
  } catch (err) {
    console.error('/list error:', err);
    ctx.reply('Failed to fetch deals. Please try again later.');
  }
});

bot.command('status', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const dealId = Number(args[0]);
  if (isNaN(dealId)) {
    return ctx.reply('Usage: /status <dealId>\nExample: /status 42');
  }

  try {
    const { state, parties, desc, submitted } = await readDealInfo(dealId);
    const [buyer, seller] = parties;
    const [buyerDone, sellerDone] = submitted;

    ctx.reply(
      `📋 *Deal #${dealId}*\n\n` +
        `*Description:* ${desc}\n` +
        `*State:* ${STATE_LABELS[state] ?? `Unknown (${state})`}\n` +
        `*Buyer:* \`${buyer.slice(0, 10)}...${buyer.slice(-4)}\` ${buyerDone ? '✅ submitted' : '⏳ waiting'}\n` +
        `*Seller:* \`${seller.slice(0, 10)}...${seller.slice(-4)}\` ${sellerDone ? '✅ submitted' : '⏳ waiting'}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          Markup.button.url('Open Deal', dealUrl(dealId)),
          state === 0 && !buyerDone ? [Markup.button.url('Submit Price', dealUrl(dealId, 'submit'))] : [],
          Markup.button.url('Share', dealUrl(dealId)),
        ].filter((row) => row.length > 0)),
      }
    );
  } catch {
    ctx.reply(`Deal #${dealId} not found.`);
  }
});

bot.command('create', (ctx) => {
  const url = `${FRONTEND_URL}?action=create`;
  ctx.reply(
    `🆕 *Create a New Deal*\n\nOpen BlindDeal to create a confidential negotiation.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('Open BlindDeal', url)],
      ]),
    }
  );
});

bot.command('submit', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const dealId = Number(args[0]);
  if (isNaN(dealId)) {
    return ctx.reply('Usage: /submit <dealId>\nExample: /submit 42');
  }

  try {
    const { state } = await readDealInfo(dealId);
    if (state !== 0) {
      return ctx.reply(`Deal #${dealId} is not Open (state: ${STATE_LABELS[state]}). You cannot submit a price.`);
    }

    const url = dealUrl(dealId, 'submit');
    ctx.reply(
      `💰 *Submit Price — Deal #${dealId}*\n\nOpen BlindDeal to encrypt and submit your price.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('Submit Encrypted Price', url)],
        ]),
      }
    );
  } catch {
    ctx.reply(`Deal #${dealId} not found.`);
  }
});

bot.command('share', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const dealId = Number(args[0]);
  if (isNaN(dealId)) {
    return ctx.reply('Usage: /share <dealId>');
  }

  const url = dealUrl(dealId);

  ctx.reply(
    `🔗 *Share Deal #${dealId}*\n\n${url}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.url('Open in BlindDeal', url),
      ]),
    }
  );
});

bot.command('subscribe', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const dealId = Number(args[0]);
  if (isNaN(dealId)) {
    return ctx.reply('Usage: /subscribe <dealId>');
  }
  const chatId = String(ctx.chat.id);
  subscribe(chatId, dealId);
  ctx.reply(`🔔 Subscribed to updates for Deal #${dealId}`);
});

bot.command('unsubscribe', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const dealId = Number(args[0]);
  if (isNaN(dealId)) {
    return ctx.reply('Usage: /unsubscribe <dealId>');
  }
  const chatId = String(ctx.chat.id);
  unsubscribe(chatId, dealId);
  ctx.reply(`🔕 Unsubscribed from Deal #${dealId}`);
});

bot.command('subscriptions', (ctx) => {
  const chatId = String(ctx.chat.id);
  const subs = subscriptions[chatId] || [];
  if (subs.length === 0) {
    return ctx.reply('You have no active subscriptions.');
  }
  ctx.reply(
    `📬 *Your Subscriptions*\n\n` + subs.map((id) => `• Deal #${id} — [Open](${dealUrl(id)})`).join('\n'),
    { parse_mode: 'Markdown', disable_web_page_preview: true }
  );
});

// ── Event polling ───────────────────────────────────────────────

let lastCheckedBlock = 0n;

async function pollEvents() {
  try {
    const currentBlock = await arbClient.getBlockNumber();
    if (lastCheckedBlock === 0n) {
      lastCheckedBlock = currentBlock;
      console.log(`[Telegram] Event polling started at block ${currentBlock}`);
      return;
    }
    if (currentBlock <= lastCheckedBlock) return;

    const logs = await arbClient.getContractEvents({
      address: CONTRACTS[arbitrumSepolia.id],
      abi: BLIND_DEAL_ABI,
      fromBlock: lastCheckedBlock + 1n,
      toBlock: currentBlock,
    });

    for (const log of logs) {
      const eventName = log.eventName;
      const args = log.args as any;
      const dealId = Number(args.dealId);

      for (const [chatId, dealIds] of Object.entries(subscriptions)) {
        if (!dealIds.includes(dealId)) continue;

        try {
          let msg = '';
          let buttons: any[] = [];

          switch (eventName) {
            case 'DealCreated':
              msg = `🆕 *Deal #${dealId} Created*\n\n*Buyer:* \`${args.buyer}\`\n*Seller:* \`${args.seller === '0x0000000000000000000000000000000000000000' ? 'Open (marketplace)' : args.seller}\`\n*Description:* ${args.description}`;
              buttons = [Markup.button.url('Open Deal', dealUrl(dealId))];
              break;
            case 'DealJoined':
              msg = `🤝 *Seller Joined Deal #${dealId}*\n\n*Seller:* \`${args.seller}\`\nNegotiation can now begin.`;
              buttons = [Markup.button.url('Open Deal', dealUrl(dealId))];
              break;
            case 'PriceSubmitted':
              msg = `💰 *Price Submitted* for Deal #${dealId}\n\nParty: \`${args.party}\``;
              buttons = [Markup.button.url('Open Deal', dealUrl(dealId))];
              break;
            case 'DealResolving':
              msg = `⚙️ *Deal #${dealId} Resolving*\n\nFHE computation in progress...`;
              buttons = [Markup.button.url('Open Deal', dealUrl(dealId))];
              break;
            case 'DealResolved': {
              const label = STATE_LABELS[args.state] ?? `State ${args.state}`;
              msg = `⚡ *Deal #${dealId} Resolved: ${label}*`;
              buttons = [Markup.button.url('Open Deal', dealUrl(dealId))];
              if (args.state === 1) {
                buttons.push(Markup.button.url('Submit Price', dealUrl(dealId, 'submit')));
              }
              break;
            }
            case 'DealCancelled':
              msg = `❌ *Deal #${dealId} Cancelled* by \`${args.cancelledBy}\``;
              break;
            case 'DealExpired':
              msg = `⏰ *Deal #${dealId} Expired*\n\nThe deadline has passed without resolution.`;
              break;
          }

          if (msg) {
            await bot.telegram.sendMessage(chatId, msg, {
              parse_mode: 'Markdown',
              ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {}),
            });
          }
        } catch (err) {
          console.warn(`Failed to notify ${chatId}:`, err);
        }
      }
    }

    lastCheckedBlock = currentBlock;
  } catch (err) {
    console.error('Polling error:', err);
  }
}

// Poll every 15 seconds
setInterval(pollEvents, 15_000);

// ── Start ───────────────────────────────────────────────────────

console.log(`[Telegram] Using BlindDeal at ${CONTRACTS[arbitrumSepolia.id]} on Arbitrum Sepolia`);
console.log(`[Telegram] FRONTEND_URL = ${FRONTEND_URL}`);

async function startBot(retried = false) {
  try {
    await bot.launch({ dropPendingUpdates: retried });
    console.log('BlindDeal Telegram bot started');
  } catch (err: any) {
    const is409 = err?.response?.error_code === 409 || (err?.message || '').includes('409');
    if (is409 && !retried) {
      console.log('Telegram 409 conflict — old polling session still active.');
      console.log('Waiting 60s for it to expire...');
      await new Promise((r) => setTimeout(r, 60000));
      return startBot(true);
    }
    throw err;
  }
}
    throw err;
  }
}

startBot().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});

process.once('SIGINT', async () => { await bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', async () => { await bot.stop('SIGTERM'); process.exit(0); });
