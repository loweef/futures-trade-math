# futures-trade-math

[![CI](https://github.com/loweef/futures-trade-math/actions/workflows/ci.yml/badge.svg)](https://github.com/loweef/futures-trade-math/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Small, zero-dependency formulas for the cost and risk side of crypto futures trading: round-trip fees, funding cost, the exact break-even price, break-even win rate, fee-aware position sizing, an isolated-margin liquidation estimate and funding APR.

There are two implementations of the same functions, one in JavaScript (ESM) and one in Python. Both are tested against one shared file of test vectors, `test-vectors.json`, so they return the same numbers.

The library contains no exchange data. Every fee rate, funding rate and maintenance margin rate is an input that you supply.

## Contents

- [Conventions](#conventions)
- [Install and use](#install-and-use)
- [Functions](#functions)
- [Formulas and derivations](#formulas-and-derivations)
- [Worked example](#worked-example)
- [Limitations](#limitations)
- [Tests](#tests)
- [Related](#related)

## Conventions

- **Linear contracts.** These are USDT- or USDC-margined contracts, where PnL = quantity × price change. Inverse (coin-margined) contracts are not covered.
- **Rates are decimal fractions.** `0.0005` means 0.05%. Negative fee rates (maker rebates) are allowed.
- **Quantity is in base units.** For example, 0.2 BTC. Notional = quantity × price.
- **Funding sign.** A positive funding rate means longs pay shorts. `funding_cost` returns a positive value when the position pays and a negative value when it receives.
- **Side** is `"long"` or `"short"`. Invalid input raises `RangeError` in JS and `ValueError` in Python.

## Install and use

There is no registry package yet. Install straight from GitHub, or copy the single source file into your project.

JavaScript (Node 18+, browsers, Deno, Bun):

```sh
npm install github:loweef/futures-trade-math
```

```js
import { breakEvenPrice, fundingCost } from 'futures-trade-math';

const funding = fundingCost(10000, 0.0001, 3, 'long');                  // 3
const be = breakEvenPrice('long', 50000, 0.2, 0.0005, 0.0005, funding); // 50065.0325...
```

Python (3.8+; CI tests 3.10, 3.12 and 3.13):

```sh
pip install "git+https://github.com/loweef/futures-trade-math#subdirectory=python"
```

```python
from futures_trade_math import break_even_price, funding_cost

funding = funding_cost(10000, 0.0001, 3, "long")                       # 3.0
be = break_even_price("long", 50000, 0.2, 0.0005, 0.0005, funding)     # 50065.0325...
```

## Functions

| Python | JavaScript | Returns |
|---|---|---|
| `round_trip_fee(notional, entry_fee_rate, exit_fee_rate, exit_notional=None)` | `roundTripFee(notional, entryFeeRate, exitFeeRate, exitNotional = notional)` | Total fee, in quote currency |
| `funding_cost(notional, funding_rate, settlements, side)` | `fundingCost(notional, fundingRate, settlements, side)` | Funding paid (+) or received (−) |
| `break_even_price(side, entry_price, quantity, entry_fee_rate, exit_fee_rate, funding=0)` | `breakEvenPrice(side, entryPrice, quantity, entryFeeRate, exitFeeRate, funding = 0)` | Exit price with zero net PnL |
| `break_even_win_rate(reward, risk, cost=0)` | `breakEvenWinRate(reward, risk, cost = 0)` | Win rate as a fraction |
| `effective_reward_risk(reward, risk, cost=0)` | `effectiveRewardRisk(reward, risk, cost = 0)` | Reward/risk after costs |
| `position_size(equity, risk_fraction, entry_price, stop_price, entry_fee_rate=0, exit_fee_rate=0)` | `positionSize(equity, riskFraction, entryPrice, stopPrice, entryFeeRate = 0, exitFeeRate = 0)` | Quantity in base units |
| `liquidation_price_isolated(side, entry_price, leverage, maintenance_margin_rate)` | `liquidationPriceIsolated(side, entryPrice, leverage, maintenanceMarginRate)` | Approximate liquidation price |
| `funding_apr(funding_rate, interval_hours=8)` | `fundingApr(fundingRate, intervalHours = 8)` | Simple annualized rate as a fraction |

## Formulas and derivations

Notation: `E` = entry price, `P` = exit price, `S` = stop price, `q` = quantity, `N` = notional, `f_in` and `f_out` = entry and exit fee rates, `F` = funding paid, `r` = funding rate per interval.

### 1. Round-trip fee

```
fee = N_entry · f_in + N_exit · f_out
```

Each fill is charged on its own notional. If the exit price is unknown, `N_exit = N_entry` is the usual approximation. Example: 10,000 × 0.0002 + 11,000 × 0.0005 = 2 + 5.5 = **7.5**.

### 2. Funding holding cost

```
F = N · r · n · s        s = +1 (long), −1 (short)
```

`n` is the number of funding settlements while the position is open. On an exchange that settles at fixed times, count the settlement timestamps your position spans. For an expected cost, use `n = holding_hours / interval_hours`, which may be fractional. Funding is charged on the position's notional at each settlement. This function uses the entry notional. Example: 10,000 × 0.0001 × 3 = **3** paid by a long and received by a short.

### 3. Exact break-even price

The exit fee is charged on the exit notional `q·P`, so it depends on the break-even price itself. Set the net PnL to zero and solve for `P`.

Long:

```
q (P − E) = q E f_in + q P f_out + F
P (1 − f_out) = E (1 + f_in) + F / q
P = (E (1 + f_in) + F / q) / (1 − f_out)
```

Short:

```
q (E − P) = q E f_in + q P f_out + F
P (1 + f_out) = E (1 − f_in) − F / q
P = (E (1 − f_in) − F / q) / (1 + f_out)
```

A common shortcut is `E · (1 + f_in + f_out)`. It puts the break-even slightly too close to entry for a long and slightly too far for a short, because it ignores that the exit fee is charged at `P` and not at `E`. The difference is small at low fee rates but grows with the fee rate and with funding.

Example (long, no funding): E = 100, f_in = f_out = 0.0005 gives P = 100.05 / 0.9995 = **100.100050025…** The shortcut gives 100.1.

### 4. Break-even win rate

Let `W` be the reward (distance to target), `L` the risk (distance to stop) and `c` the round-trip cost per trade, all in the same unit. A win nets `W − c` and a loss costs `L + c`. Zero expectancy means:

```
p (W − c) = (1 − p)(L + c)
p = (L + c) / (W + L)
```

Example: a 2:1 setup with a cost of 0.1 R needs p = 1.1 / 3 = **36.67%**, not 33.33%.

### 5. Effective reward/risk after costs

```
RR_net = (W − c) / (L + c)
```

This is consistent with (4), since `p = 1 / (1 + RR_net)`. Example: (2 − 0.1) / (1 + 0.1) = **1.727**.

### 6. Fee-aware position size

Choose `q` so that being stopped out loses exactly `A · r`, where `A` is account equity and `r` is the risk fraction. Fees are included, and the exit fee is charged at the stop price:

```
q (|E − S| + E f_in + S f_out) = A · r
q = A · r / (|E − S| + E f_in + S f_out)
```

Example: A = 10,000, r = 1%, E = 100, S = 98 and fees of 0.05% each way. Then q = 100 / (2 + 0.05 + 0.049) = 100 / 2.099 = **47.64** units, or a notional of $4,764. Without fees the formula would give 50 units, and a stop-out would then lose about $105 instead of $100.

### 7. Isolated liquidation price (approximation)

With isolated margin `E·q / lev` and a flat maintenance margin rate `mmr`, liquidation happens when equity in the position falls to `mmr · P · q`. Using the common simplification that maintenance margin is measured on the entry notional:

```
Long:  P_liq = E (1 − 1/lev + mmr)
Short: P_liq = E (1 + 1/lev − mmr)
```

Example: a 10x long at 100 with mmr 0.5% gives **90.5**. A 10x short gives **109.5**.

### 8. Funding APR

```
APR = r · (24 / h) · 365
```

`h` is the funding interval in hours. Simple annualization is used, not compounding. Example: 0.01% every 8 h gives 0.0001 × 3 × 365 = **10.95%**. The same rate every 1 h gives **87.6%**.

## Worked example

This example is a long position of 0.2 BTC at 50,000 (notional 10,000), with 0.05% taker fees on entry and exit and a funding rate of +0.01% per 8 h, held for 24 h (3 settlements).

| Step | Calculation | Result |
|---|---|---|
| Round-trip fee (exit at entry) | 10,000 × 0.0005 × 2 | 10 |
| Funding paid | 10,000 × 0.0001 × 3 | 3 |
| Break-even price | (50,000 × 1.0005 + 3 / 0.2) / 0.9995 | 50,065.03 |
| Distance to break-even | 65.03 / 50,000 | 0.130% |

Check: selling 0.2 at 50,065.03 gives a gross profit of 13.0065. The entry fee is 5, the exit fee is 0.2 × 50,065.03 × 0.0005 = 5.0065 and funding is 3. Net = 13.0065 − 5 − 5.0065 − 3 = 0.

## Limitations

- **No slippage or spread.** Fill prices are assumed to equal the input prices. To account for slippage, add it to the fee rate or to `cost`.
- **Flat maintenance margin.** Exchanges use tiered maintenance margin (a higher rate for larger positions), maintenance amount deductions, mark price rather than last price, and liquidation fees. Treat `liquidation_price_isolated` as an estimate and confirm the price on your exchange.
- **Cross margin is not modeled.** In cross margin, the liquidation price depends on the whole account.
- **Constant funding.** `funding_cost` uses one rate for the whole holding period and the entry notional. Real funding changes at every settlement, and the notional changes with the mark price.
- **Fixed cost per trade.** `break_even_win_rate` and `effective_reward_risk` treat cost as one constant per trade. In practice the exit fee differs slightly between the target and the stop.
- **Linear contracts only.** Inverse contracts have PnL in the base coin and need different formulas.
- **Simple APR.** `funding_apr` does not compound.
- Floating-point results match the hand calculations to a relative tolerance of 1e-12.

These are educational formulas, not financial advice.

## Tests

`test-vectors.json` holds 31 cases. Each one names a function, its arguments, and either an expected value or an expected error. Most cases include the hand calculation in a `hand` field. Both test runners load the same file.

```sh
npm test                                              # JavaScript (node:test)
cd python && python -m unittest discover -s tests -v  # Python (unittest)
```

Both suites also check two identities: `p = 1 / (1 + RR_net)`, and that net PnL is zero at the break-even price. CI runs Node 18/20/22 and Python 3.10/3.12/3.13.

## Related

Two TradingView indicators use the same break-even and funding formulas on a chart: [Cost Compass](https://www.tradingview.com/script/roDZVuXx-Cost-Compass-loweef/) and [Funding Compass](https://www.tradingview.com/script/ieTSVquu-Funding-Compass-loweef/).

## License

[MIT](LICENSE). To cite this repository, see [CITATION.cff](CITATION.cff).

---

Maintained by loweef (https://loweef.io)
