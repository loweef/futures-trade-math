// futures-trade-math — cost and risk formulas for linear (USDT-margined) crypto futures.
// Zero dependencies. All rates are decimal fractions (0.0005 = 0.05%).
// The Python package in ../python implements the same functions; both are checked
// against ../test-vectors.json.

const SIDES = Object.freeze(['long', 'short']);
const HOURS_PER_DAY = 24;
const DAYS_PER_YEAR = 365;

function assertFinite(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number, got ${value}`);
  }
}

function assertPositive(name, value) {
  assertFinite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be > 0, got ${value}`);
}

function assertNonNegative(name, value) {
  assertFinite(name, value);
  if (value < 0) throw new RangeError(`${name} must be >= 0, got ${value}`);
}

function assertFeeRate(name, value) {
  assertFinite(name, value);
  if (value <= -1 || value >= 1) throw new RangeError(`${name} must be in (-1, 1), got ${value}`);
}

function assertFraction(name, value) {
  assertFinite(name, value);
  if (value <= 0 || value >= 1) throw new RangeError(`${name} must be in (0, 1), got ${value}`);
}

function sideSign(side) {
  if (!SIDES.includes(side)) throw new RangeError(`side must be "long" or "short", got ${side}`);
  return side === 'long' ? 1 : -1;
}

/**
 * Round-trip trading fee.
 *
 *   fee = N_entry * f_entry + N_exit * f_exit
 *
 * N_exit defaults to N_entry (exit at the entry price).
 * A negative fee rate (maker rebate) lowers the total.
 */
export function roundTripFee(notional, entryFeeRate, exitFeeRate, exitNotional = notional) {
  assertNonNegative('notional', notional);
  assertNonNegative('exitNotional', exitNotional);
  assertFeeRate('entryFeeRate', entryFeeRate);
  assertFeeRate('exitFeeRate', exitFeeRate);
  return notional * entryFeeRate + exitNotional * exitFeeRate;
}

/**
 * Funding paid while holding a perpetual position.
 *
 *   F = N * r * n * s      s = +1 long, -1 short
 *
 * r is the funding rate per settlement interval, n the number of settlements held
 * (fractional values give an expected cost, e.g. holding_hours / interval_hours).
 * Positive result = the position pays; negative = the position receives.
 */
export function fundingCost(notional, fundingRate, settlements, side) {
  assertNonNegative('notional', notional);
  assertFinite('fundingRate', fundingRate);
  assertNonNegative('settlements', settlements);
  return notional * fundingRate * settlements * sideSign(side);
}

/**
 * Exact break-even exit price, with the exit fee charged at the break-even price.
 *
 *   Long:  q (P - E) = q E f_in + q P f_out + F   =>  P = (E (1 + f_in) + F / q) / (1 - f_out)
 *   Short: q (E - P) = q E f_in + q P f_out + F   =>  P = (E (1 - f_in) - F / q) / (1 + f_out)
 *
 * E entry price, q quantity (base units), F funding paid (see fundingCost).
 */
export function breakEvenPrice(side, entryPrice, quantity, entryFeeRate, exitFeeRate, funding = 0) {
  const s = sideSign(side);
  assertPositive('entryPrice', entryPrice);
  assertPositive('quantity', quantity);
  assertFeeRate('entryFeeRate', entryFeeRate);
  assertFeeRate('exitFeeRate', exitFeeRate);
  assertFinite('funding', funding);
  return (entryPrice * (1 + s * entryFeeRate) + s * funding / quantity) / (1 - s * exitFeeRate);
}

/**
 * Break-even win rate for a fixed reward/risk with a per-trade cost.
 *
 *   p (W - c) = (1 - p) (L + c)   =>   p = (L + c) / (W + L)
 *
 * W reward (target distance), L risk (stop distance), c round-trip cost per trade,
 * all in the same unit (price, percent or currency). Returns a fraction in [0, 1+).
 */
export function breakEvenWinRate(reward, risk, cost = 0) {
  assertPositive('reward', reward);
  assertPositive('risk', risk);
  assertNonNegative('cost', cost);
  return (risk + cost) / (reward + risk);
}

/**
 * Reward/risk ratio after costs.
 *
 *   RR_net = (W - c) / (L + c)
 *
 * Consistent with breakEvenWinRate: p = 1 / (1 + RR_net).
 */
export function effectiveRewardRisk(reward, risk, cost = 0) {
  assertPositive('reward', reward);
  assertPositive('risk', risk);
  assertNonNegative('cost', cost);
  return (reward - cost) / (risk + cost);
}

/**
 * Position size (base units) so that a stop-out loses exactly equity * riskFraction,
 * including the entry fee and the exit fee charged at the stop price.
 *
 *   q (|E - S| + E f_in + S f_out) = A * r   =>   q = A r / (|E - S| + E f_in + S f_out)
 *
 * Notional = q * E. Funding and slippage are not included.
 */
export function positionSize(equity, riskFraction, entryPrice, stopPrice, entryFeeRate = 0, exitFeeRate = 0) {
  assertPositive('equity', equity);
  assertFraction('riskFraction', riskFraction);
  assertPositive('entryPrice', entryPrice);
  assertPositive('stopPrice', stopPrice);
  assertFeeRate('entryFeeRate', entryFeeRate);
  assertFeeRate('exitFeeRate', exitFeeRate);
  if (entryPrice === stopPrice) throw new RangeError('stopPrice must differ from entryPrice');
  const lossPerUnit = Math.abs(entryPrice - stopPrice) + entryPrice * entryFeeRate + stopPrice * exitFeeRate;
  if (lossPerUnit <= 0) throw new RangeError('loss per unit at the stop must be > 0');
  return (equity * riskFraction) / lossPerUnit;
}

/**
 * Approximate isolated-margin liquidation price with a flat maintenance margin rate.
 *
 *   Long:  P_liq = E (1 - 1/lev + mmr)
 *   Short: P_liq = E (1 + 1/lev - mmr)
 *
 * Ignores tiered maintenance margin, fees, funding and added margin.
 */
export function liquidationPriceIsolated(side, entryPrice, leverage, maintenanceMarginRate) {
  const s = sideSign(side);
  assertPositive('entryPrice', entryPrice);
  assertPositive('leverage', leverage);
  assertFinite('maintenanceMarginRate', maintenanceMarginRate);
  if (maintenanceMarginRate < 0 || maintenanceMarginRate >= 1) {
    throw new RangeError(`maintenanceMarginRate must be in [0, 1), got ${maintenanceMarginRate}`);
  }
  return entryPrice * (1 - s / leverage + s * maintenanceMarginRate);
}

/**
 * Annualized funding rate (simple, not compounded).
 *
 *   APR = r * (24 / h) * 365
 *
 * r funding rate per interval, h interval length in hours.
 */
export function fundingApr(fundingRate, intervalHours = 8) {
  assertFinite('fundingRate', fundingRate);
  assertPositive('intervalHours', intervalHours);
  return fundingRate * (HOURS_PER_DAY / intervalHours) * DAYS_PER_YEAR;
}
