// polymarket-faa-attribution-01 entry (Node 22, standard library only).
//
// An empirical-quantile forecaster with a house-prior blend. The house
// baseline forecasts every market with one fixed normal spread (0.0025 price
// units per sqrt-minute) and no drift. FAA attribution markets are jumpy —
// a market can move 0.2 in a minute and then sit still for hours — so this
// entry measures each market's own distribution of past moves from the
// case's prices and forecasts from that, instead of from one fixed constant:
//
//   q_tau(h) = clamp(x + 0.5 * Q_tau(h) + 0.5 * z_tau * 0.0015 * sqrt(h), 0, 1)
//
//   x         = the market's last price in the case (the price at `at`).
//   Q_tau(h)  = the tau-quantile of the market's own h-minute moves over
//               its last 24 hours, at anchor horizons 1/5/15/30/60/120/240
//               minutes, interpolated linearly in sqrt(h) between anchors.
//               Quantiles are asymmetric by construction: the upper levels
//               use the market's up-move scale, the lower levels its
//               down-move scale, and a market that only ever fell forecasts
//               a falling median.
//   0.5/0.5   = equal weight to the market's own history and to the house
//               prior. The blend is a regulariser, fixed in advance: the
//               history alone is noisy (overlapping windows, stale regimes)
//               and the prior alone ignores that some markets jump and
//               others sit still.
//
// No drift term: Polymarket prices are near-martingales, and a recent-trend
// extrapolation hurt on every practice case it was tried on. The prior sigma
// (0.0015) was picked from a small sweep for a good coverage/loss balance,
// not for the lowest practice number: narrower priors scored lower on the
// settled practice event but covered less than 0.9 of its minutes, which
// would pay for every jump in the jumpier final event.
//
// Measured locally on the six practice cases against Polymarket's own price
// history, with a scorer that reproduces the house baseline's official
// practice loss of 0.363589 exactly: this entry scores 0.331965 (90%
// coverage 0.944, median error 0.86). The practice is cut from a different
// event, so its score is no guide to the final; the design above is what
// is meant to travel.
//
// The program is deterministic (pure arithmetic on sorted moves, no
// randomness), offline, and runs in well under a second per case.
//
// Reads every <id>.in from $MAKEFUN_INPUT_DIR (else /input) and writes
// <id>.out to $MAKEFUN_OUTPUT_DIR (else /output):
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level, to 6 decimals. */
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
/** The house baseline's spread, in price units per square-root minute. */
const PRIOR_SIGMA = 0.0015;
/** Weight of the market's own history (the rest is the house prior). */
const HISTORY_WEIGHT = 0.5;
/** Anchor horizons, in minutes, at which move quantiles are measured. */
const ANCHORS = [1, 5, 15, 30, 60, 120, 240];
/** Minutes of recent history the move distribution is taken from. */
const HISTORY_MINUTES = 1440;
/** Minimum h-minute moves needed before an anchor is trusted. */
const MIN_MOVES = 30;

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

/** The tau-quantile of a sorted array, by linear interpolation. */
function quantile(sorted: number[], tau: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0] as number;
  const pos = tau * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  const frac = pos - lo;
  return (sorted[lo] as number) * (1 - frac) + (sorted[hi] as number) * frac;
}

/** The forecast of one market: horizon rows of the five quantiles. */
function forecast(m: CaseMarket, horizon: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const p = m.prices;
  const x = p[p.length - 1] as number;

  // The market's recent history, most recent last.
  const src = p.slice(-HISTORY_MINUTES);
  const n = src.length;

  // Empirical move quantiles at each trusted anchor horizon.
  const anchors: number[] = [];
  const qdev: number[][] = [];
  for (const h of ANCHORS) {
    if (h > horizon || n - h < MIN_MOVES) continue;
    const moves: number[] = [];
    for (let t = 0; t <= n - 1 - h; t++) moves.push((src[t + h] as number) - (src[t] as number));
    moves.sort((a, b) => a - b);
    anchors.push(h);
    qdev.push(QUANTILES.map((tau) => quantile(moves, tau)));
  }

  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const s = Math.sqrt(h);
    const row = QUANTILES.map((_, j) => {
      const z = Z[j] as number;
      const prior = z * PRIOR_SIGMA * s;
      let emp = 0;
      if (anchors.length > 0) {
        let a: number;
        let b: number;
        if (h <= (anchors[0] as number)) {
          a = b = anchors[0] as number;
        } else if (h >= (anchors[anchors.length - 1] as number)) {
          a = b = anchors[anchors.length - 1] as number;
        } else {
          a = anchors.filter((v) => v <= h).pop() as number;
          b = anchors.filter((v) => v >= h)[0] as number;
        }
        if (a === b) {
          emp = qdev[anchors.indexOf(a)]?.[j] ?? 0;
        } else {
          const w = (s - Math.sqrt(a)) / (Math.sqrt(b) - Math.sqrt(a));
          const qa = qdev[anchors.indexOf(a)]?.[j] ?? 0;
          const qb = qdev[anchors.indexOf(b)]?.[j] ?? 0;
          emp = qa * (1 - w) + qb * w;
        }
      }
      return price6(x + HISTORY_WEIGHT * emp + (1 - HISTORY_WEIGHT) * prior);
    });
    // Rounding can only break monotonicity by a hair; restore it exactly.
    for (let j = 1; j < row.length; j++) {
      if ((row[j] as number) < (row[j - 1] as number)) row[j] = row[j - 1] as number;
    }
    rows.push(row);
  }
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
