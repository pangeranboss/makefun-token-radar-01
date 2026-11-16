// Token Radar — the model (radar-2). One sealed snapshot in, one ranked board out.
//
// The board ranks protocols that record no token, by the implied value a token
// launch would carry if the protocol's record stayed as it is. It never predicts
// whether or when a token is issued: the implied value is this entry's own claim.
//
// Coverage: every slug on the snapshot's watchlist (the floor), plus every other
// protocol the watchlist's own rule would keep if the $50M floor were lifted —
// the early radar. A protocol is a launch candidate when it records no token
// (mcap, gecko_id and symbol all null), is not an exchange, not a bridge, not a
// liquid-staking or restaking product, carries no whole word wrapped / staked /
// staking in its name, does not begin with an exchange's name, and its name does
// not end in a version marker. Wrapped, staked and bridged products of a token
// that already trades are not launches waiting to happen, so they stay out.
//
// Implied value — function impliedValue below — uses only the snapshot's own
// figures: TVL, the 7-day TVL change, and how long the protocol has run with no
// token (listed_at). No protocol name is ever special-cased.
//
//   base      = tvl_usd x 0.30
//   growth    = clamp(change_7d, -50, 150) per cent; unknown change counts as 0
//   growthMult   = 1 + 0.6 x growth / 100
//   maturity  = 0.55 + 0.45 x sqrt(min(age_days, 1460) / 1460); unknown age = 365
//   implied   = max(1, round(base x growthMult x maturity))
//
// The square-root maturity curve is deliberate: a protocol earns most of its
// staying-power credit in its first years, and the curve flattens after four.
// Growth is capped so one wild week cannot crown a protocol, and floored so a
// bad week cannot erase one. Protocols whose token already trades are kept
// apart in the Live view, shown at the market's own value, never ranked here.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Already trading view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_per_tvl: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  pre_token_count: number;
  live_count: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The model's one function: a protocol's implied launch value in whole dollars,
 * from its TVL, its 7-day change and its age. Returns the value plus every
 * multiplier, so the dashboard can show the arithmetic instead of asserting it.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; base: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    model.maturity_range * Math.sqrt(Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, base: Math.round(base), growthPct, growthMult, maturityMult, age };
}

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking: a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a launch candidate never begins with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories that are a wrapped, bridged or staked product, not a launch of their own. */
const NOT_A_LAUNCH = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether the protocol's record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a launch candidate under the watchlist's own rule:
 * pre-token, not an exchange, bridge or staking product, not a versioned pool,
 * not named for a wrapped or staked product, not named after an exchange.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && NOT_A_LAUNCH.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, whatever its size.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other launch candidate below the watchlist floor,
  // by the same rule, without the size line. A chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (p.tvl_usd >= snapshot.floor_usd) continue;
    if (!isLaunchCandidate(p)) continue;
    chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      base_usd: s.v.base,
      growth_pct: Math.round(s.v.growthPct * 100) / 100,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on the protocol's main chain, from the chain's own fees. */
function gasNote(p: SnapshotProtocol): string {
  const chain = chainOf(p).toLowerCase();
  if (chain === 'ethereum') return 'about $8 of gas on Ethereum mainnet';
  if (chain === 'solana') return 'under $0.10 of gas on Solana';
  if (chain === 'bitcoin' || chain === 'tron') return 'about $2 of gas';
  if (['base', 'arbitrum', 'optimism', 'polygon', 'ink', 'mode', 'blast', 'zksync era', 'scroll', 'linea', 'monad', 'hyperliquid l1', 'berachain', 'sonic', 'sui', 'aptos', 'avalanche'].includes(chain)) {
    return `under $0.50 of gas on ${chainOf(p)}`;
  }
  return 'a few dollars of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/**
 * The category's two moves: the position to open first, and the second action
 * that keeps the wallet active. Every pair names the protocol's own instrument,
 * so the plan reads like the protocol, not like a template.
 */
function movesFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${n} on ${chain} and leave it earning.`,
      `Borrow $20 of USDC against the deposit, then repay it in full the same week.`,
    ];
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return [
      `Provide $${capital} of liquidity to ${n}'s deepest USDC pool on ${chain} and keep the position open.`,
      `Swap $10 of USDC for the pool's other asset through ${n} once a week.`,
    ];
  }
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('liquidity manager')) {
    return [
      `Deposit $${capital} of USDC into ${n}'s highest-TVL vault on ${chain} and hold the vault shares.`,
      `Move $25 between two of ${n}'s vaults once, so the wallet shows more than one strategy.`,
    ];
  }
  if (c.includes('risk curator') || c.includes('onchain capital allocator') || c.includes('allocator')) {
    return [
      `Deposit $${capital} of USDC into a ${n} curated vault on ${chain} and hold the vault shares.`,
      `Allocate $25 to a second curator vault on ${n} the following week.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`,
      `Claim the asset's accrued yield once a month and leave the principal untouched.`,
    ];
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) {
    return [
      `Deposit $${capital} of USDC as margin on ${n} on ${chain} and open one small hedged position.`,
      `Close the position after a week and open one more at a quarter of the size.`,
    ];
  }
  if (c.includes('basis trading')) {
    return [
      `Deposit $${capital} of USDC into ${n}'s basis vault on ${chain} and hold the position.`,
      `Top the vault up by $25 after the first month if its yield is still positive.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint $${capital} of the stable asset through ${n} on ${chain} and hold it in the farming wallet.`,
      `Use $20 of the minted stable asset in one of ${n}'s own pools, then return it.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund ${n} with $${capital} of USDC on ${chain} and take one small position in a market closing this month.`,
      `Take one more position the next week, in the opposite direction, for half the size.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${n} on ${chain} for a stablecoin pool you already use.`,
      `File no claim; renew the cover once if the protocol asks for an active policy.`,
    ];
  }
  if (c.includes('launchpad')) {
    return [
      `Stake $${capital} of USDC in ${n}'s launch pool on ${chain} before its next sale opens.`,
      `Vote in ${n}'s next community proposal, even a routine one, from the same wallet.`,
    ];
  }
  if (c.includes('restak') || c.includes('staking pool')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and keep the receipt token.`,
      `Restake the receipt token once in ${n}'s own restaking pool, if it offers one.`,
    ];
  }
  if (c.includes('farm') || c.includes('index')) {
    return [
      `Deposit $${capital} of USDC into ${n}'s main farm or index on ${chain} and hold the shares.`,
      `Harvest the farm's rewards once and compound them back into the same position.`,
    ];
  }
  if (c.includes('chain')) {
    return [
      `Bridge $${capital} of USDC to ${chain} through ${n}'s own bridge and use it in one app there.`,
      `Send one transaction a week on ${chain} from the farming wallet, such as a swap or a vote.`,
    ];
  }
  if (c.includes('payment') || c.includes('card')) {
    return [
      `Load $${capital} of USDC into ${n} on ${chain} and make one real payment with it.`,
      `Make a second payment the next week, to a different merchant or address.`,
    ];
  }
  if (c.includes('ai agent') || c.includes('decentralized ai')) {
    return [
      `Deposit $${capital} of USDC into ${n} on ${chain} and run one of its agents or jobs.`,
      `Run a second job the following week and keep the output receipt.`,
    ];
  }
  if (c.includes('nft')) {
    return [
      `Buy one ${n} listing on ${chain} for about $${capital} and hold it in the farming wallet.`,
      `List it for sale once at a fair price, then delist it if it does not sell.`,
    ];
  }
  if (c.includes('privacy')) {
    return [
      `Deposit $${capital} of USDC into ${n}'s shielded pool on ${chain} and keep the note safe.`,
      `Withdraw half the deposit after a month and redeposit it the same day.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`,
    `Use ${n} a second way the following week, such as a swap, a vote or a second pool.`,
  ];
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record — category, chains, TVL
 * and age — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(p);
  const [first, second] = movesFor(p, capital, chain);
  const secondAmount = /(\$[0-9][0-9,]*) of/.exec(second);
  const secondCost = secondAmount !== null ? `about ${secondAmount[1]!} moved and ${gas}` : `the second position and ${gas}`;
  const weeklyGas = chain.toLowerCase() === 'ethereum' ? 'about $8 of gas a week' : 'under $1 of gas a week';
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper, and fund it with $${capital + 10} of USDC on ${chain}.`,
      cost: gas,
      time: '10 minutes',
    },
    { text: first, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: second, cost: secondCost, time: '10 minutes' },
    {
      text: `Do one qualifying action each week — a deposit, a swap, a vote or a claim — so the wallet stays active across snapshots.`,
      cost: weeklyGas,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity is counted in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from the link it publishes, claim only there, and log every transaction date and amount.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Already trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      mcap_per_tvl: Math.round(((p.mcap_usd as number) / Math.max(1, p.tvl_usd)) * 100) / 100,
    }));
}

/** A board row's compact form for data.js, with the farm plan and the model's numbers. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_usd: row.model.base_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: onWatchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const preCount = snapshot.protocols.filter(isPreToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    pre_token_count: preCount,
    live_count: snapshot.protocols.length - preCount,
    rows: board.map((r) => radarRow(r, watch.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} exceeds the value cap`;
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
