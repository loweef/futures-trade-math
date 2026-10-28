import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ftm from './index.mjs';

const vectors = JSON.parse(readFileSync(new URL('../test-vectors.json', import.meta.url), 'utf8'));

// Positional parameter order of each JavaScript function (snake_case, as in the vectors).
const PARAMS = Object.freeze({
  round_trip_fee: ['notional', 'entry_fee_rate', 'exit_fee_rate', 'exit_notional'],
  funding_cost: ['notional', 'funding_rate', 'settlements', 'side'],
  break_even_price: ['side', 'entry_price', 'quantity', 'entry_fee_rate', 'exit_fee_rate', 'funding'],
  break_even_win_rate: ['reward', 'risk', 'cost'],
  effective_reward_risk: ['reward', 'risk', 'cost'],
  position_size: ['equity', 'risk_fraction', 'entry_price', 'stop_price', 'entry_fee_rate', 'exit_fee_rate'],
  liquidation_price_isolated: ['side', 'entry_price', 'leverage', 'maintenance_margin_rate'],
  funding_apr: ['funding_rate', 'interval_hours'],
});

const toCamel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function call(fnName, args) {
  const fn = ftm[toCamel(fnName)];
  assert.equal(typeof fn, 'function', `missing export for ${fnName}`);
  const order = PARAMS[fnName];
  const unknown = Object.keys(args).filter((k) => !order.includes(k));
  assert.deepEqual(unknown, [], `unknown args for ${fnName}`);
  // Trailing omitted args become undefined, which triggers the JS default value.
  return fn(...order.map((k) => args[k]));
}

const { relative, absolute } = vectors.tolerance;

for (const c of vectors.cases) {
  test(`${c.id} ${c.fn}`, () => {
    if (c.throws) {
      assert.throws(() => call(c.fn, c.args), RangeError);
      return;
    }
    const got = call(c.fn, c.args);
    const diff = Math.abs(got - c.expected);
    assert.ok(diff <= Math.max(absolute, relative * Math.abs(c.expected)), `${c.id}: got ${got}, expected ${c.expected}`);
  });
}

test('every exported function is covered by at least one vector', () => {
  const covered = new Set(vectors.cases.map((c) => toCamel(c.fn)));
  for (const name of Object.keys(ftm)) assert.ok(covered.has(name), `${name} has no vector`);
});

test('break-even win rate equals 1 / (1 + effective reward/risk)', () => {
  for (const [w, l, c] of [[2, 1, 0.1], [1.5, 1, 0.3], [3, 2, 0]]) {
    const p = ftm.breakEvenWinRate(w, l, c);
    const rr = ftm.effectiveRewardRisk(w, l, c);
    assert.ok(Math.abs(p - 1 / (1 + rr)) < 1e-12);
  }
});

test('long break-even price closes the trade at exactly zero net PnL', () => {
  const [e, q, fin, fout, f] = [50000, 0.2, 0.0005, 0.0005, 3];
  const p = ftm.breakEvenPrice('long', e, q, fin, fout, f);
  const net = q * (p - e) - q * e * fin - q * p * fout - f;
  assert.ok(Math.abs(net) < 1e-9);
});
