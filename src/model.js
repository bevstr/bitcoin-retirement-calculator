// Pure projection math. No DOM, no network — everything here is unit tested.

/** Spending periods, expressed as how many occur in a year. */
export const PERIODS_PER_YEAR = {
  day: 365.25,
  week: 365.25 / 7,
  month: 12,
  year: 1,
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Annual percentage -> monthly compounding rate. -100% and below is floored. */
export function monthlyRate(annualPct) {
  const annual = Math.max(Number(annualPct) || 0, -99.99) / 100;
  return Math.pow(1 + annual, 1 / 12) - 1;
}

/** Spend expressed per `period` -> the equivalent spend per month. */
export function toMonthlySpend(amount, period) {
  const perYear = PERIODS_PER_YEAR[period];
  if (!perYear) throw new Error(`unknown period: ${period}`);
  return (Number(amount) || 0) * (perYear / 12);
}

/** Monthly amount -> the equivalent amount per `period`. */
export function fromMonthlySpend(monthly, period) {
  const perYear = PERIODS_PER_YEAR[period];
  if (!perYear) throw new Error(`unknown period: ${period}`);
  return monthly * (12 / perYear);
}

function asRate(pct) {
  return Math.max(Number(pct) || 0, 0) / 100;
}

/**
 * Fiat received from selling one BTC at `price`, after selling fees on the
 * gross proceeds and estimated tax on the gain above `costBasis` only.
 * Capital losses are not modelled: if price <= cost basis, tax is zero.
 */
export function salePerBtc(price, costBasis = 0, taxRate = 0, feeRate = 0) {
  const p = Math.max(Number(price) || 0, 0);
  const basis = Math.max(Number(costBasis) || 0, 0);
  const fees = p * asRate(feeRate);
  const tax = Math.max(p - basis, 0) * asRate(taxRate);
  return {price: p, fees, tax, net: p - fees - tax};
}

/** @returns {number} net fiat proceeds from selling one BTC */
export function netProceedsPerBtc(price, costBasis = 0, taxRate = 0, feeRate = 0) {
  return salePerBtc(price, costBasis, taxRate, feeRate).net;
}

/**
 * Once the price path cannot cross the cost basis again, net proceeds follow
 * a single formula forever and the remaining BTC drawdown has a geometric tail.
 */
function inTerminalRegime(price, g, basis) {
  if (g === 0) return true;
  if (g > 0) return price > basis;
  return price <= basis;
}

/**
 * BTC that must be sold to raise `need` net fiat at this month's price.
 * Infinity when a sale would not yield positive net proceeds.
 */
function btcToRaise(need, price, costBasis, taxRate, feeRate) {
  const net = netProceedsPerBtc(price, costBasis, taxRate, feeRate);
  if (need <= 0) return 0;
  if (net <= 0) return Infinity;
  return need / net;
}

/**
 * BTC required to fund an initial monthly spend of `monthlySpend0` forever,
 * stepping the same price / inflation / sale math as the finite projection.
 *
 * The infinite sum of BTC sold is
 *   Σ  spend₀ · (1+inf)^m  /  netProceeds(price₀ · (1+g)^m)
 * It is not a pure geometric series once tax depends on max(price − basis, 0),
 * so this sums exact monthly terms and, once the price path can no longer
 * cross the cost basis, adds a geometric tail. The tail bounds use the local
 * term ratio and the asymptotic ratio r = (1+inf)/(1+g); they agree to a
 * tight tolerance before we stop, so the result is not a truncated horizon.
 *
 * Returns Infinity when the series diverges (CAGR ≤ inflation, or net
 * proceeds eventually hit zero).
 */
function infiniteBtcNeeded(monthlySpend0, price0, g, inf, costBasis, taxRate, feeRate) {
  if (monthlySpend0 <= 0) return 0;
  if (price0 <= 0) return Infinity;

  const r = (1 + inf) / (1 + g);
  // Same non-convergence rule as the previous closed form: when growth does
  // not outrun inflation the terms do not decay (for proceeds that scale
  // with price) and no finite stack lasts forever.
  if (!(r < 1)) return Infinity;

  const REL = 1e-14;
  const MAX = 200000;
  let total = 0;
  let p = price0;
  let spend = monthlySpend0;

  for (let m = 0; m < MAX; m++) {
    const sell = btcToRaise(spend, p, costBasis, taxRate, feeRate);
    if (!isFinite(sell)) return Infinity;
    total += sell;

    const nextP = p * (1 + g);
    const nextSpend = spend * (1 + inf);
    const nextSell = btcToRaise(nextSpend, nextP, costBasis, taxRate, feeRate);
    if (!isFinite(nextSell)) return Infinity;

    // Remaining path is in one sale regime, so consecutive terms approach a
    // geometric series. Bound the tail between the local ratio and r; keep
    // summing exact months until that interval is negligible.
    if (
      sell > 0 &&
      inTerminalRegime(p, g, costBasis) &&
      inTerminalRegime(nextP, g, costBasis)
    ) {
      const ratio = nextSell / sell;
      const q = Math.max(ratio, r);
      if (q < 1) {
        const tailHi = nextSell / (1 - q);
        const tailLo = nextSell / (1 - r);
        if (tailHi - tailLo <= REL * Math.max(total, Number.EPSILON)) {
          return total + tailHi;
        }
      }
    }

    p = nextP;
    spend = nextSpend;
  }

  return Infinity;
}

/**
 * Project a bitcoin stack being drawn down to fund spending.
 *
 * The model steps monthly. In each month you sell enough bitcoin at that
 * month's price to cover the month's spending (after selling fees on the
 * gross sale and estimated capital-gains tax on the gain above the entered
 * average cost basis), then the price compounds by one month of the
 * projected CAGR. Spending itself compounds by one month of inflation, so
 * the *purchasing power* of the withdrawal is held constant.
 *
 * @param {object} input
 * @param {number} input.btc            bitcoin held today
 * @param {number} input.price          bitcoin price today, in fiat
 * @param {number} input.spendAmount    spend per `spendPeriod`, in fiat, in today's money
 * @param {string} input.spendPeriod    'day' | 'week' | 'month' | 'year'
 * @param {number} input.cagr           projected annual bitcoin growth, percent
 * @param {number} input.inflation      annual inflation applied to spending, percent
 * @param {number} [input.taxRate]      estimated tax rate on capital gains, percent
 * @param {number} [input.costBasis]    estimated average cost basis, fiat per BTC
 * @param {number} [input.feeRate]      selling fees on gross proceeds, percent
 * @param {number} [input.horizonYears] how far to project
 */
export function project({
  btc,
  price,
  spendAmount,
  spendPeriod,
  cagr,
  inflation,
  taxRate = 0,
  costBasis = 0,
  feeRate = 0,
  horizonYears = 50,
}) {
  const startBtc = Math.max(Number(btc) || 0, 0);
  const startPrice = Math.max(Number(price) || 0, 0);
  const basis = Math.max(Number(costBasis) || 0, 0);
  const g = monthlyRate(cagr);
  const inf = monthlyRate(inflation);
  const netMonthly = toMonthlySpend(spendAmount, spendPeriod);

  const maxMonths = Math.round(clamp(horizonYears, 1, 200) * 12);

  const series = [];
  let balance = startBtc;
  let p = startPrice;
  let spentFiat = 0;
  let soldBtc = 0;
  let taxPaid = 0;
  let feesPaid = 0;
  let depletionMonth = null;

  for (let m = 0; m <= maxMonths; m++) {
    series.push({month: m, btc: balance, price: p, value: balance * p});
    if (m === maxMonths) break;

    if (balance <= 0 || p <= 0) {
      depletionMonth = m;
      break;
    }

    const need = netMonthly * Math.pow(1 + inf, m);
    const sale = salePerBtc(p, basis, taxRate, feeRate);

    if (need > 0 && sale.net <= 0) {
      // A sale would not raise positive net proceeds, so this month cannot
      // be funded even with bitcoin still in hand.
      depletionMonth = m;
      break;
    }

    const sell = btcToRaise(need, p, basis, taxRate, feeRate);

    if (sell >= balance) {
      // The stack runs out partway through this month.
      const covered = sell > 0 ? balance / sell : 0;
      depletionMonth = m + covered;
      spentFiat += need * covered;
      soldBtc += balance;
      taxPaid += sale.tax * balance;
      feesPaid += sale.fees * balance;
      balance = 0;
      series.push({month: depletionMonth, btc: 0, price: p, value: 0});
      break;
    }

    balance -= sell;
    soldBtc += sell;
    spentFiat += need;
    taxPaid += sale.tax * sell;
    feesPaid += sale.fees * sell;
    p *= 1 + g;
  }

  const unitBtc = infiniteBtcNeeded(1, startPrice, g, inf, basis, taxRate, feeRate);
  const requiredBtc = !isFinite(unitBtc) ? Infinity : netMonthly * unitBtc;
  const sustainableMonthly = !isFinite(unitBtc) || unitBtc === 0 ? 0 : startBtc / unitBtc;

  const last = series[series.length - 1];

  return {
    series,
    depletionMonth,
    /** true when the stack outlives the projection horizon */
    survivesHorizon: depletionMonth === null,
    /** true when the drawdown converges — it never runs out, at any horizon */
    perpetual: isFinite(requiredBtc) && startBtc >= requiredBtc,
    requiredBtc,
    sustainableMonthly,
    sustainableInPeriod: fromMonthlySpend(sustainableMonthly, spendPeriod),
    netMonthly,
    spentFiat,
    soldBtc,
    taxPaid,
    feesPaid,
    endBtc: last.btc,
    endValue: last.value,
    endPrice: last.price,
    horizonMonths: maxMonths,
  };
}

/** 27.4 -> "27 years 5 months" */
export function formatDuration(months) {
  if (months === null || !isFinite(months)) return '—';
  const whole = Math.floor(months);
  const y = Math.floor(whole / 12);
  const m = whole % 12;
  const parts = [];
  if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m || !y) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** Calendar date `months` from `from`, without mutating `from`. */
export function addMonths(from, months) {
  const d = new Date(from.getTime());
  d.setMonth(d.getMonth() + Math.floor(months));
  return d;
}
