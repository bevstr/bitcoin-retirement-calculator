import test from 'node:test';
import assert from 'node:assert/strict';
import {
  project,
  monthlyRate,
  toMonthlySpend,
  fromMonthlySpend,
  formatDuration,
  addMonths,
  PERIODS_PER_YEAR,
  netProceedsPerBtc,
  salePerBtc,
} from '../src/model.js';

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (tol ${tol})`);

const relNear = (a, b, tol = 1e-9) =>
  assert.ok(
    Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)),
    `expected ${a} ≈ ${b} (rel ${tol})`,
  );

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

test('existing day/week/month/year spending conversions still work', () => {
  const common = {btc: 2, price: 90000, cagr: 15, inflation: 3};
  const monthly = project({...common, spendAmount: 1200, spendPeriod: 'month'});
  const yearly = project({...common, spendAmount: 14400, spendPeriod: 'year'});
  const weekly = project({...common, spendAmount: 1200 * (12 / (365.25 / 7)), spendPeriod: 'week'});
  const daily = project({...common, spendAmount: 1200 * (12 / 365.25), spendPeriod: 'day'});
  near(monthly.depletionMonth, yearly.depletionMonth, 1e-9);
  near(monthly.depletionMonth, weekly.depletionMonth, 1e-9);
  near(monthly.depletionMonth, daily.depletionMonth, 1e-9);
  near(monthly.soldBtc, yearly.soldBtc, 1e-9);
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

test('zero tax and zero fees match the old no-haircut projection', () => {
  const r = project({
    btc: 1,
    price: 100000,
    spendAmount: 2000,
    spendPeriod: 'month',
    cagr: 10,
    inflation: 3,
    taxRate: 0,
    costBasis: 0,
    feeRate: 0,
    horizonYears: 40,
  });
  const g = monthlyRate(10);
  const inf = monthlyRate(3);
  // Month-0 sale is spend / price; later months inflate spend and grow price.
  near(r.series[0].btc - r.series[1].btc, 2000 / 100000, 1e-12);
  near(r.series[1].price, 100000 * (1 + g), 1e-9);
  const need1 = 2000 * (1 + inf);
  const np1 = netProceedsPerBtc(r.series[1].price, 0, 0, 0);
  near(r.series[1].btc - r.series[2].btc, need1 / np1, 1e-12);
  near(r.taxPaid, 0, 1e-12);
  near(r.feesPaid, 0, 1e-12);
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
  near(r.spentFiat, 10000, 1e-6);
});

test('partial depletion still works with tax and fees', () => {
  // np per BTC = 10000 - 100 (1% fees) - 0 tax (price == basis) = 9900.
  // 1 BTC funds 9900 net; spending 4000/mo -> 9900/4000 = 2.475 months.
  const r = project({
    btc: 1,
    price: 10000,
    spendAmount: 4000,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 0,
    costBasis: 10000,
    taxRate: 30,
    feeRate: 1,
  });
  near(r.depletionMonth, 9900 / 4000, 1e-9);
  near(r.soldBtc, 1, 1e-12);
  near(r.taxPaid, 0, 1e-12);
  near(r.feesPaid, 100, 1e-9);
});

test('price above cost basis: tax applies only to the gain', () => {
  const sale = salePerBtc(100000, 40000, 25, 0);
  near(sale.tax, 15000, 1e-12);
  near(sale.fees, 0, 1e-12);
  near(sale.net, 85000, 1e-12);

  // Spending exactly the net proceeds of 1 BTC sells exactly 1 BTC.
  const r = project({
    btc: 1,
    price: 100000,
    spendAmount: 85000,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 0,
    costBasis: 40000,
    taxRate: 25,
    feeRate: 0,
    horizonYears: 5,
  });
  near(r.depletionMonth, 1, 1e-9);
  near(r.soldBtc, 1, 1e-12);
  near(r.taxPaid, 15000, 1e-6);
  near(r.spentFiat, 85000, 1e-6);
});

test('price equal to cost basis: zero capital-gains tax', () => {
  const sale = salePerBtc(50000, 50000, 30, 1);
  near(sale.tax, 0, 1e-12);
  near(sale.fees, 500, 1e-12);
  near(sale.net, 49500, 1e-12);

  const r = project({
    btc: 1,
    price: 50000,
    spendAmount: 49500,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 0,
    costBasis: 50000,
    taxRate: 30,
    feeRate: 1,
    horizonYears: 5,
  });
  near(r.depletionMonth, 1, 1e-9);
  near(r.taxPaid, 0, 1e-12);
  near(r.feesPaid, 500, 1e-6);
});

test('price below cost basis: zero capital-gains tax', () => {
  const sale = salePerBtc(30000, 50000, 30, 1);
  near(sale.tax, 0, 1e-12);
  near(sale.fees, 300, 1e-12);
  near(sale.net, 29700, 1e-12);

  const r = project({
    btc: 2,
    price: 30000,
    spendAmount: 29700,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 0,
    costBasis: 50000,
    taxRate: 30,
    feeRate: 1,
    horizonYears: 5,
  });
  near(r.depletionMonth, 2, 1e-9);
  near(r.taxPaid, 0, 1e-12);
  near(r.feesPaid, 600, 1e-6);
});

test('fees apply to the entire gross sale', () => {
  const sale = salePerBtc(100000, 0, 0, 2);
  near(sale.fees, 2000, 1e-12);
  near(sale.tax, 0, 1e-12);
  near(sale.net, 98000, 1e-12);

  const r = project({
    btc: 1,
    price: 100000,
    spendAmount: 98000,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 0,
    feeRate: 2,
    horizonYears: 5,
  });
  near(r.depletionMonth, 1, 1e-9);
  near(r.soldBtc, 1, 1e-12);
  near(r.feesPaid, 2000, 1e-6);
  near(r.taxPaid, 0, 1e-12);
});

test('tax and fees together calculate the BTC sale required correctly', () => {
  // price 100000, basis 40000, tax 20%, fees 2%
  // fees = 2000, gain = 60000, tax = 12000, net = 86000
  const sale = salePerBtc(100000, 40000, 20, 2);
  near(sale.fees, 2000, 1e-12);
  near(sale.tax, 12000, 1e-12);
  near(sale.net, 86000, 1e-12);

  const r = project({
    btc: 1,
    price: 100000,
    spendAmount: 43000,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 0,
    costBasis: 40000,
    taxRate: 20,
    feeRate: 2,
    horizonYears: 5,
  });
  near(r.series[0].btc - r.series[1].btc, 0.5, 1e-12);
  near(r.depletionMonth, 2, 1e-9);
  near(r.soldBtc, 1, 1e-12);
  near(r.taxPaid, 12000, 1e-6);
  near(r.feesPaid, 2000, 1e-6);
  near(r.spentFiat, 86000, 1e-6);
});

test('with a zero cost basis, tax on gains matches the old whole-sale haircut', () => {
  const g = monthlyRate(10);
  const inf = monthlyRate(3);
  const rOld = (1 + inf) / (1 + g);
  const netMonthly = 2000;
  const grossUp = 1 / 0.7;
  const expectedRequired = (netMonthly * grossUp) / (100000 * (1 - rOld));

  const r = project({
    btc: 1,
    price: 100000,
    spendAmount: 2000,
    spendPeriod: 'month',
    cagr: 10,
    inflation: 3,
    costBasis: 0,
    taxRate: 30,
    feeRate: 0,
  });
  relNear(r.requiredBtc, expectedRequired, 1e-12);
  near(r.netMonthly, 2000);
  assert.ok(r.taxPaid > 0);
});

test('inflation still compounds correctly', () => {
  const r = project({
    btc: 50,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 12,
    horizonYears: 3,
  });
  const inf = monthlyRate(12);
  for (let m = 0; m < 24; m++) {
    const sold = r.series[m].btc - r.series[m + 1].btc;
    const need = 1000 * Math.pow(1 + inf, m);
    near(sold * r.series[m].price, need, 1e-6);
  }
});

test('CAGR monthly conversion remains correct along the series', () => {
  const r = project({
    btc: 10,
    price: 80000,
    spendAmount: 100,
    spendPeriod: 'month',
    cagr: 20,
    inflation: 0,
    horizonYears: 5,
  });
  const g = monthlyRate(20);
  near(Math.pow(1 + g, 12) - 1, 0.2, 1e-12);
  for (let m = 0; m < r.series.length; m++) {
    if (r.series[m].month !== m) continue;
    near(r.series[m].price, 80000 * Math.pow(1 + g, m), 1e-6);
  }
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

  const atThreshold = project({...base, btc: probe.requiredBtc});
  assert.equal(atThreshold.survivesHorizon, true);
  assert.equal(atThreshold.perpetual, true);

  const under = project({...base, btc: probe.requiredBtc * 0.98});
  assert.equal(under.survivesHorizon, false);
  assert.equal(under.perpetual, false);
});

test('perpetual threshold stays consistent with tax, basis and fees', () => {
  const base = {
    btc: 1,
    price: 100000,
    spendAmount: 1500,
    spendPeriod: 'month',
    cagr: 18,
    inflation: 3,
    costBasis: 25000,
    taxRate: 20,
    feeRate: 1,
    horizonYears: 100,
  };
  const probe = project(base);
  assert.ok(isFinite(probe.requiredBtc));

  const above = project({...base, btc: probe.requiredBtc * (1 + 1e-9)});
  assert.equal(above.perpetual, true);
  assert.equal(above.survivesHorizon, true);

  const below = project({...base, btc: probe.requiredBtc * (1 - 1e-9)});
  assert.equal(below.perpetual, false);

  const clearlyUnder = project({...base, btc: probe.requiredBtc * 0.98});
  assert.equal(clearlyUnder.survivesHorizon, false);
  assert.equal(clearlyUnder.perpetual, false);
});

test('sustainableMonthly and requiredBtc agree with each other', () => {
  const base = {
    btc: 3,
    price: 80000,
    spendAmount: 2500,
    spendPeriod: 'month',
    cagr: 25,
    inflation: 4,
    costBasis: 20000,
    taxRate: 15,
    feeRate: 0.5,
    horizonYears: 100,
  };
  const r = project(base);
  assert.ok(r.sustainableMonthly > 0);
  assert.ok(isFinite(r.requiredBtc));
  relNear(r.requiredBtc * r.sustainableMonthly, base.btc * r.netMonthly, 1e-10);

  const funded = project({...base, spendAmount: r.sustainableMonthly});
  relNear(funded.requiredBtc, base.btc, 1e-9);
  assert.equal(funded.survivesHorizon, true);
  assert.equal(funded.perpetual, true);

  const over = project({...base, spendAmount: r.sustainableMonthly * 1.05});
  assert.equal(over.survivesHorizon, false);
  assert.equal(over.perpetual, false);
});

test('sustainable spend agrees with the simulation when tax is zero', () => {
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

  const at = project({...base, spendAmount: sustainableMonthly});
  assert.equal(at.survivesHorizon, true);

  const over = project({...base, spendAmount: sustainableMonthly * 1.05});
  assert.equal(over.survivesHorizon, false);
});

test('100% selling fees with positive spending cannot fund forever', () => {
  const r = project({
    btc: 10,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 20,
    inflation: 3,
    feeRate: 100,
    horizonYears: 50,
  });
  assert.equal(r.requiredBtc, Infinity);
  assert.equal(r.perpetual, false);
  assert.ok(r.series.every(p => p.btc >= 0 && isFinite(p.btc) && isFinite(p.value)));
});

test('tax and fees that leave no net proceeds cannot fund forever', () => {
  // 10% fees + 100% tax on a zero basis: net = 0.9p − p < 0.
  const r = project({
    btc: 10,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 20,
    inflation: 3,
    costBasis: 0,
    taxRate: 100,
    feeRate: 10,
    horizonYears: 50,
  });
  assert.equal(r.requiredBtc, Infinity);
  assert.equal(r.perpetual, false);
  assert.ok(r.series.every(p => p.btc >= 0 && isFinite(p.btc) && isFinite(p.value)));
});

test('inflation outrunning growth means nothing is sustainable', () => {
  const r = project({
    btc: 100,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 2,
    inflation: 5,
    costBasis: 10000,
    taxRate: 20,
    feeRate: 1,
  });
  assert.equal(r.perpetual, false);
  assert.equal(r.sustainableMonthly, 0);
  assert.equal(r.requiredBtc, Infinity);
  assert.ok(r.depletionMonth === null || r.depletionMonth > 12 * 50);
});

test('a negative CAGR still terminates', () => {
  const r = project({
    btc: 5,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: -40,
    inflation: 3,
    costBasis: 20000,
    taxRate: 25,
    feeRate: 1,
    horizonYears: 50,
  });
  assert.ok(r.depletionMonth !== null);
  assert.ok(r.depletionMonth > 0);
  assert.ok(r.series.every(p => p.btc >= 0 && isFinite(p.value)));
});

test('spend period choice does not change the answer', () => {
  const common = {btc: 2, price: 90000, cagr: 15, inflation: 3, costBasis: 30000, taxRate: 10, feeRate: 0.25};
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
  assert.equal(r.perpetual, true);
  near(r.endBtc, 1);
  near(r.endValue, 100000 * Math.pow(1.1, 30), 1);
  near(r.requiredBtc, 0, 1e-12);
});

test('zero spend is perpetual even when CAGR is below inflation', () => {
  const r = project({
    btc: 1,
    price: 100000,
    spendAmount: 0,
    spendPeriod: 'month',
    cagr: 2,
    inflation: 5,
    taxRate: 25,
    costBasis: 30000,
    feeRate: 1,
    horizonYears: 30,
  });
  assert.equal(r.requiredBtc, 0);
  assert.equal(r.perpetual, true);
  assert.equal(r.survivesHorizon, true);
  near(r.endBtc, 1);
  assert.equal(r.sustainableMonthly, 0);
});

test('series is monotonically non-increasing in btc and starts at the stack', () => {
  const r = project({
    btc: 2.5,
    price: 75000,
    spendAmount: 500,
    spendPeriod: 'week',
    cagr: 18,
    inflation: 3,
    costBasis: 15000,
    taxRate: 20,
    feeRate: 0.5,
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
  assert.equal(formatDuration(13.9), '1 year 1 month 27 days');
  assert.equal(formatDuration(329), '27 years 5 months');
  assert.equal(formatDuration(null), '—');
});

test('formatDuration does not drop a fractional final month', () => {
  assert.equal(formatDuration(2.5), '2 months 15 days');
  assert.notEqual(formatDuration(2.5), '2 months');
  const r = project({
    btc: 1,
    price: 10000,
    spendAmount: 4000,
    spendPeriod: 'month',
    cagr: 0,
    inflation: 0,
  });
  near(r.depletionMonth, 2.5, 1e-9);
  assert.equal(formatDuration(r.depletionMonth), '2 months 15 days');
});

test('addMonths includes the fractional month as days', () => {
  const from = new Date(2020, 0, 15);
  const got = addMonths(from, 2.5);
  const want = new Date(2020, 0, 15);
  want.setMonth(want.getMonth() + 2);
  want.setDate(want.getDate() + Math.round(0.5 * (365.25 / 12)));
  assert.equal(got.getTime(), want.getTime());
  assert.ok(got.getTime() > addMonths(from, 2).getTime());
});

test('100% tax with a positive basis does not report a finite perpetual stack', () => {
  const r = project({
    btc: 10,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 20,
    inflation: 3,
    costBasis: 40000,
    taxRate: 100,
    feeRate: 0,
    horizonYears: 50,
  });
  assert.equal(r.requiredBtc, Infinity);
  assert.equal(r.perpetual, false);
  assert.equal(r.sustainableMonthly, 0);
});

test('a very high but sub-100% combined tax and fee rate can still converge', () => {
  // alpha = 1 - 0.01 - 0.90 = 0.09 > 0, so net still grows with price.
  const r = project({
    btc: 50,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 20,
    inflation: 3,
    costBasis: 40000,
    taxRate: 90,
    feeRate: 1,
    horizonYears: 50,
  });
  assert.ok(isFinite(r.requiredBtc), `requiredBtc=${r.requiredBtc}`);
  assert.ok(r.requiredBtc > 0);
  assert.ok(r.sustainableMonthly > 0);
  const at = project({
    btc: r.requiredBtc,
    price: 100000,
    spendAmount: 1000,
    spendPeriod: 'month',
    cagr: 20,
    inflation: 3,
    costBasis: 40000,
    taxRate: 90,
    feeRate: 1,
    horizonYears: 100,
  });
  assert.equal(at.perpetual, true);
  assert.equal(at.survivesHorizon, true);
});

test('audited 6.25 BTC scenario matches independent reference values', () => {
  const r = project({
    btc: 6.25,
    price: 107789,
    spendAmount: 8000,
    spendPeriod: 'month',
    cagr: 25,
    inflation: 3,
    taxRate: 25,
    costBasis: 30000,
    feeRate: 0.5,
    horizonYears: 30,
  });
  // Independently summed; not taken from project().
  relNear(r.requiredBtc, 5.96844623648538, 1e-12);
  relNear(r.sustainableMonthly, 8377.3896955539, 1e-12);
  relNear(r.endBtc, 0.300258884031486, 1e-12);
  relNear(r.endPrice, 87071260.7875792, 1e-12);
  relNear(r.endValue, 26143919.595293, 1e-12);
  relNear(r.spentFiat, 4629704.29988788, 1e-12);
  relNear(r.soldBtc, 5.94974111596852, 1e-12);
  assert.equal(r.perpetual, true);
});
