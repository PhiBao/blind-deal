import { Telegraf, Markup } from 'telegraf';
import { createPublicClient, http, parseAbi } from 'viem';
import { arbitrumSepolia, sepolia } from 'viem/chains';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is required in .env');
  process.exit(1);
}

// ── Contract config ─────────────────────────────────────────────────

const BLIND_DEAL_ABI = parseAbi([
  'event DealCreated(uint256 indexed dealId, address indexed buyer, address indexed seller, string description)',
  'event PriceSubmitted(uint256 indexed dealId, address indexed party)',
  'event DealResolved(uint256 indexed dealId, uint8 state)',
  'event DealCancelled(uint256 indexed dealId, address indexed cancelledBy)',
  'function getDealState(uint256 dealId) view returns (uint8)',
  'function getDealParties(uint256 dealId) view returns (address buyer, address seller)',
  'function getDealDescription(uint256 dealId) view returns (string)',
  'function isDealSubmitted(uint256 dealId) view returns (bool buyerDone, bool sellerDone)',
  'function dealCount() view returns (uint256)',
] as const);

const CONTRACTS: Record<number, `0x${string}`> = {
  [arbitrumSepolia.id]: '0x802841705BF377a01C050E26a4488598001906C5',
  [sepolia.id]: '0x049A114756edF01064861F40c4B6979d5eccAdE8',
};

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://blinddeal.vercel.app';

// ── Viem clients ────────────────────────────────────────────────────

const arbClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL),
});

const ethClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

// ── Subscription store ──────────────────────────────────────────────

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

// ── Bot ─────────────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply(
    `🔐 *Welcome to BlindDeal Bot*\n\n` +
      `I notify you about confidential deal negotiations on Fhenix.\n\n` +
      `*Commands:*\n` +
      `/status <dealId> — Check deal status\n` +
      `/share <dealId> — Get a shareable link\n` +
      `/subscribe <dealId> — Get notified when the deal updates\n` +
      `/unsubscribe <dealId> — Stop notifications\n\n` +
      `Every deal is end-to-end encrypted with FHE.`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('status', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const dealId = Number(args[0]);
  if (isNaN(dealId)) {
    return ctx.reply('Usage: /status <dealId>');
  }

  try {
    const [state, parties, desc, submitted] = await Promise.all([
      arbClient.readContract({
        address: CONTRACTS[arbitrumSepolia.id],
        abi: BLIND_DEAL_ABI,
        functionName: 'getDealState',
        args: [BigInt(dealId)],
      }),
      arbClient.readContract({
        address: CONTRACTS[arbitrumSepolia.id],
        abi: BLIND_DEAL_ABI,
        functionName: 'getDealParties',
        args: [BigInt(dealId)],
      }),
      arbClient.readContract({
        address: CONTRACTS[arbitrumSepolia.id],
        abi: BLIND_DEAL_ABI,
        functionName: 'getDealDescription',
        args: [BigInt(dealId)],
      }),
      arbClient.readContract({
        address: CONTRACTS[arbitrumSepolia.id],
        abi: BLIND_DEAL_ABI,
        functionName: 'isDealSubmitted',
        args: [BigInt(dealId)],
      }),
    ]);

    const stateLabels = ['Open', 'Matched', 'No Match', 'Cancelled'];
    const [buyer, seller] = parties;
    const [buyerDone, sellerDone] = submitted;

    ctx.reply(
      `📋 *Deal #${dealId}*\n` +
        `*Description:* ${desc}\n` +
        `*State:* ${stateLabels[state]}\n` +
        `*Buyer:* \`${buyer}\` ${buyerDone ? '✅' : '⏳'}\n` +
        `*Seller:* \`${seller}\` ${sellerDone ? '✅' : '⏳'}`,
      { parse_mode: 'Markdown' }
    );
  } catch {
    ctx.reply('Deal not found or RPC error.');
  }
});

bot.command('share', (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const dealId = Number(args[0]);
  if (isNaN(dealId)) {
    return ctx.reply('Usage: /share <dealId>');
  }

  const url = `${FRONTEND_URL}?deal=${dealId}&chain=${arbitrumSepolia.id}`;

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
    `📬 *Your Subscriptions*\n\n` + subs.map((id) => `• Deal #${id}`).join('\n'),
    { parse_mode: 'Markdown' }
  );
});

// ── Event polling ───────────────────────────────────────────────────

let lastCheckedBlock = 0n;

async function pollEvents() {
  try {
    const currentBlock = await arbClient.getBlockNumber();
    if (lastCheckedBlock === 0n) {
      lastCheckedBlock = currentBlock;
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

      // Notify all subscribers for this deal
      for (const [chatId, dealIds] of Object.entries(subscriptions)) {
        if (dealIds.includes(dealId)) {
          try {
            if (eventName === 'DealCreated') {
              await bot.telegram.sendMessage(
                chatId,
                `🆕 *Deal #${dealId} Created*\n\n*Buyer:* \`${args.buyer}\`\n*Seller:* \`${args.seller}\`\n*Description:* ${args.description}`,
                { parse_mode: 'Markdown' }
              );
            } else if (eventName === 'PriceSubmitted') {
              await bot.telegram.sendMessage(
                chatId,
                `💰 *Price Submitted* for Deal #${dealId}\n\nParty: \`${args.party}\``,
                { parse_mode: 'Markdown' }
              );
            } else if (eventName === 'DealResolved') {
              const stateLabels = ['Open', 'Matched', 'No Match', 'Cancelled'];
              const stateLabel = stateLabels[args.state];
              await bot.telegram.sendMessage(
                chatId,
                `⚡ *Deal #${dealId} Resolved: ${stateLabel}*`,
                { parse_mode: 'Markdown' }
              );
            } else if (eventName === 'DealCancelled') {
              await bot.telegram.sendMessage(
                chatId,
                `❌ *Deal #${dealId} Cancelled* by \`${args.cancelledBy}\``,
                { parse_mode: 'Markdown' }
              );
            }
          } catch (err) {
            console.warn(`Failed to notify ${chatId}:`, err);
          }
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

// ── Start ───────────────────────────────────────────────────────────

bot.launch();
console.log('BlindDeal Telegram bot started');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
