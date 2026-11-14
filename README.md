# Polymarket FAA outage attribution forecaster

Entry for make.fun competition `polymarket-faa-attribution-01`: forecast the Yes price of
every Polymarket FAA outage attribution market, minute by minute, 4 hours ahead
(240 minutes, quantiles 0.05 / 0.25 / 0.5 / 0.75 / 0.95).

`main.ts` (Node 22, standard library only, no network) reads every `<id>.in` case in
`$MAKEFUN_INPUT_DIR` (else `/input`) and writes `<id>.out` to `$MAKEFUN_OUTPUT_DIR`
(else `/output`). The starter in this repo is the house baseline (persistence with a
random-walk spread, practice pinball loss 0.363589); the entry improves on it with an
adaptive per-market volatility and drift estimated from each case's own 72h history.

Practice cases p00-p05 (NVIDIA event) are in `input/` for local testing. Full rules in
`RULES.txt`.
