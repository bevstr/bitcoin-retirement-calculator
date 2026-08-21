import test from 'node:test';
import assert from 'node:assert/strict';
import {
  project,
  monthlyRate,
  toMonthlySpend,
  fromMonthlySpend,
  formatDuration,
  PERIODS_PER_YEAR,
} from '../src/model.js';

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (tol ${tol})`);

test('monthlyRate compounds back to the annual rate', () => {
  near(Math.pow(1 + monthlyRate(20), 12) - 1, 0.2, 1e-12);
  near(Math.pow(1 + monthlyRate(-30), 12) - 1, -0.3, 1e-12);
  near(monthlyRate(0), 0);
});

test('period conversions round-trip', () => {
  for (const period of Object.keys(PERIODS_PER_YEAR)) {
    near(fromMonthlySpend(toMonthlySpend(123.45, period), period), 123.45, 1e-9);
  }
  near(toMonthlySpend(1200, 'year'), 100);
  near(toMonthlySpend(100, 'month'), 100);
});

test('flat price, no inflation: depletion is simple division', () => {
  // 10 BTC at $1,000 = $10,000, spending $1,000/mo -> exactly 10 months.
  const r = project({
    btc: 10,
    price: 1000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 0,
  });
  near(r.depletionMonth, 10, 1e-9);
  near(r.spentFiat, 10000, 1e-6);
  near(r.soldBtc, 10, 1e-9);
  assert.equal(r.survivesHorizon, false);
  assert.equal(r.perpetual, false);
});

test('depletion can land mid-month', () => {
  // $10,000 of stack, $4,000/mo -> 2.5 months.
  const r = project({
    btc: 1,
    price: 10000,
    spendAmount: 4000,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 0,
  });
  near(r.depletionMonth, 2.5, 1e-9);
  near(r.series[r.series.length - 1].btc, 0);
});

test('a stack exactly at the perpetual threshold never depletes', () => {
  const base = {
    btc: 1,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 20,
    inflation: 3,
    horizonYears: 100,
  };
  const probe = project(base);

  // Fund it with exactly the required stack: it must survive the horizon.
  const atThreshold = project({...base, btc: probe.requiredBtc});
  assert.equal(atThreshold.survivesHorizon, true);
  assert.equal(atThreshold.perpetual, true);

  // A hair under, and it must not.
  const under = project({...base, btc: probe.requiredBtc * 0.98});
  assert.equal(under.survivesHorizon, false);
  assert.equal(under.perpetual, false);
});

test('closed-form sustainable spend agrees with the simulation', () => {
  const base = {
    btc: 3,
    price: 80000,
    spendAmount: 1,
    spendPeriod: 'month',
    cagr: 25,
    inflation: 4,
    horizonYears: 100,
  };
  const {sustainableMonthly} = project(base);

  // Spending exactly the sustainable amount survives 100 years...
  const at = project({...base, spendAmount: sustainableMonthly});
  assert.equal(at.survivesHorizon, true);

  // ...and 5% more does not.
  const over = project({...base, spendAmount: sustainableMonthly * 1.05});
  assert.equal(over.survivesHorizon, false);
});

test('inflation outrunning growth means nothing is sustainable', () => {
  const r = project({
    btc: 100,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 2,
    inflation: 5,
  });
  assert.equal(r.perpetual, false);
  assert.equal(r.sustainableMonthly, 0);
  assert.equal(r.requiredBtc, Infinity);
  // A big stack still lasts a long time, it just does not last forever.
  assert.ok(r.depletionMonth === null || r.depletionMonth > 12 * 50);
});

test('the tax haircut shortens the runway', () => {
  const base = {
    btc: 1,
    price: 100000,
    spendAmount: 2000,
    spendPeriod: 'month',
    cagr: 10,
    inflation: 3,
  };
  const clean = project(base);
  const taxed = project({...base, taxRate: 30});
  assert.ok(taxed.depletionMonth < clean.depletionMonth);
  // Spending is net of tax, so the fiat you actually get is unchanged per month.
  near(taxed.netMonthly, 2000);
  near(taxed.grossMonthly, 2000 / 0.7, 1e-9);
});

test('a negative CAGR still terminates', () => {
  const r = project({
    btc: 5,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: -40,
    inflation: 3,
    horizonYears: 50,
  });
  assert.ok(r.depletionMonth !== null);
  assert.ok(r.depletionMonth > 0);
  assert.ok(r.series.every(p => p.btc >= 0 && isFinite(p.value)));
});

test('spend period choice does not change the answer', () => {
  const common = {btc: 2, price: 90000, cagr: 15, inflation: 3};
  const monthly = project({...common, spendAmount: 1200, spendPeriod: 'month'});
  const yearly = project({...common, spendAmount: 14400, spendPeriod: 'year'});
  near(monthly.depletionMonth, yearly.depletionMonth, 1e-9);
});

test('zero spend never depletes', () => {
  const r = project({
    btc: 1,
    price: 100000,
    spendAmount: 0,
    spendPeriod: 'month',
    cagr: 10,
    inflation: 3,
    horizonYears: 30,
  });
  assert.equal(r.survivesHorizon, true);
  near(r.endBtc, 1);
  near(r.endValue, 100000 * Math.pow(1.1, 30), 1);
});

test('series is monotonically non-increasing in btc and starts at the stack', () => {
  const r = project({
    btc: 2.5,
    price: 75000,
    spendAmount: 500,
    spendPeriod: 'week',
    cagr: 18,
    inflation: 3,
    horizonYears: 40,
  });
  near(r.series[0].btc, 2.5);
  near(r.series[0].price, 75000);
  for (let i = 1; i < r.series.length; i++) {
    assert.ok(r.series[i].btc <= r.series[i - 1].btc + 1e-12, `btc rose at ${i}`);
  }
});

test('formatDuration reads like a human wrote it', () => {
  assert.equal(formatDuration(0), '0 months');
  assert.equal(formatDuration(1), '1 month');
  assert.equal(formatDuration(12), '1 year');
  assert.equal(formatDuration(13.9), '1 year 1 month');
  assert.equal(formatDuration(329), '27 years 5 months');
  assert.equal(formatDuration(null), '—');
});
