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

/**
 * Project a bitcoin stack being drawn down to fund spending.
 *
 * The model steps monthly. In each month you sell enough bitcoin at that
 * month's price to cover the month's spending, then the price compounds by one
 * month of the projected CAGR. Spending itself compounds by one month of
 * inflation, so the *purchasing power* of the withdrawal is held constant.
 *
 * @param {object} input
 * @param {number} input.btc            bitcoin held today
 * @param {number} input.price          bitcoin price today, in fiat
 * @param {number} input.spendAmount    spend per `spendPeriod`, in fiat, in today's money
 * @param {string} input.spendPeriod    'day' | 'week' | 'month' | 'year'
 * @param {number} input.cagr           projected annual bitcoin growth, percent
 * @param {number} input.inflation      annual inflation applied to spending, percent
 * @param {number} [input.taxRate]      percent skimmed off every sale (capital gains + fees)
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
  horizonYears = 50,
}) {
  const startBtc = Math.max(Number(btc) || 0, 0);
  const startPrice = Math.max(Number(price) || 0, 0);
  const g = monthlyRate(cagr);
  const inf = monthlyRate(inflation);

  // Selling into a tax/fee haircut means grossing the withdrawal up so the
  // amount that lands in your pocket is the amount you asked to spend.
  const haircut = clamp(Number(taxRate) || 0, 0, 95) / 100;
  const grossUp = 1 / (1 - haircut);
  const grossMonthly = toMonthlySpend(spendAmount, spendPeriod) * grossUp;
  const netMonthly = toMonthlySpend(spendAmount, spendPeriod);

  const maxMonths = Math.round(clamp(horizonYears, 1, 200) * 12);

  const series = [];
  let balance = startBtc;
  let p = startPrice;
  let spentFiat = 0;
  let soldBtc = 0;
  let depletionMonth = null;

  for (let m = 0; m <= maxMonths; m++) {
    series.push({month: m, btc: balance, price: p, value: balance * p});
    if (m === maxMonths) break;

    if (balance <= 0 || p <= 0) {
      depletionMonth = m;
      break;
    }

    const need = grossMonthly * Math.pow(1 + inf, m);
    const sell = need / p;

    if (sell >= balance) {
      // The stack runs out partway through this month.
      const covered = sell > 0 ? balance / sell : 0;
      depletionMonth = m + covered;
      spentFiat += (need * covered) / grossUp;
      soldBtc += balance;
      balance = 0;
      series.push({month: depletionMonth, btc: 0, price: p, value: 0});
      break;
    }

    balance -= sell;
    soldBtc += sell;
    spentFiat += need / grossUp;
    p *= 1 + g;
  }

  // Closed form for the perpetual case. Monthly bitcoin sold is
  //   (spend0 / price0) * r^m   where r = (1 + inflation) / (1 + growth),
  // so the whole infinite drawdown costs (spend0 / price0) / (1 - r) bitcoin.
  // It converges only when growth outruns inflation.
  const r = (1 + inf) / (1 + g);
  const converges = r < 1 && startPrice > 0;
  const requiredBtc = converges ? grossMonthly / (startPrice * (1 - r)) : Infinity;
  const sustainableMonthly = converges
    ? (startBtc * startPrice * (1 - r)) / grossUp
    : 0;

  const last = series[series.length - 1];

  return {
    series,
    depletionMonth,
    /** true when the stack outlives the projection horizon */
    survivesHorizon: depletionMonth === null,
    /** true when the drawdown converges — it never runs out, at any horizon */
    perpetual: converges && startBtc >= requiredBtc,
    requiredBtc,
    sustainableMonthly,
    sustainableInPeriod: fromMonthlySpend(sustainableMonthly, spendPeriod),
    netMonthly,
    grossMonthly,
    spentFiat,
    soldBtc,
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
