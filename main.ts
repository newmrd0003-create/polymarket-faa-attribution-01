// polymarket-faa-attribution-01's house baseline (Node 22, standard library only): persistence. It forecasts
// that each market's Yes price stays where it was at the checkpoint, with a spread that widens like a random walk's:
//
//   q_tau(h) = clamp(x + z_tau * 0.0025 * sqrt(h), 0, 1), rounded to 6 decimals
//
// for the minute h = 1..horizon_minutes after the checkpoint, where x is the market's last price in the case (the price
// at `at`), 0.0025 is the spread in price units per square-root minute, and z_tau is the standard normal's quantile at
// each level tau (0.05, 0.25, 0.5, 0.75, 0.95). Its numbers are fixed in advance, never tuned on any data. A prize needs
// a loss strictly below the best house entry's: this one's, or the house model one-shot's.
//
// The kit's starter/main.ts is this program byte for byte: start your entry from it. What an entry must do:
//   - read every <id>.in in the input directory (the grader runs one case at a time, with only that case's file there),
//     canonical JSON {"schema":"makefun/polymarket-case/v1","case","at","horizon_minutes","quantiles","event",
//     "markets":[{"id","name","slug","yes_token","start","prices"}]}, where `prices` holds one Yes price per minute
//     from `start` to `at` inclusive, so the last one is the price at the checkpoint;
//   - write <id>.out to the output directory: {"forecasts":[{"id","q"}]}, every market of the case exactly once (no
//     other id, no other key), `q` exactly horizon_minutes rows, row h-1 the forecast for minute at+h, each row one
//     finite number in [0,1] per quantile level, non-decreasing; at most 1 MiB. Anything else is an invalid case,
//     scored as if every quantile were 0.5, and an entry with an invalid case takes no prize.
// It runs offline, with no network, under the case's time cap: everything it knows is in the case's prices.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level, to 6 decimals. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
/** The spread of a minute's price move, in price units per square-root minute. */
const SIGMA = 0.0025;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/** The persistence forecast of one market: horizon rows of the five quantiles around its last price. */
function forecast(m: CaseMarket, horizon: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) rows.push(Z.map((z) => price6(x + z * SIGMA * Math.sqrt(h))));
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
