import {project, formatDuration, addMonths, PERIODS_PER_YEAR} from './model.js';
import {createChart} from './chart.js';

const $ = id => document.getElementById(id);

const FIELDS = {
  btc: 1,
  price: 100000,
  spend: 5000,
  period: 'month',
  cagr: 20,
  inflation: 3,
  tax: 0,
  basis: 0,
  fees: 0,
  horizon: 50,
  currency: 'USD',
};

const PERIOD_LABEL = {day: 'a day', week: 'a week', month: 'a month', year: 'a year'};

// ── formatting ────────────────────────────────────────────────────────────
let currency = 'USD';

const money = (n, opts = {}) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    ...opts,
  }).format(isFinite(n) ? n : 0);

const moneyCompact = n =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(isFinite(n) ? n : 0);

function btcAmount(n) {
  if (!isFinite(n)) return '—';
  if (n === 0) return '0 BTC';
  if (n < 0.01) return `${Math.round(n * 1e8).toLocaleString()} sats`;
  return `${n.toLocaleString(undefined, {maximumFractionDigits: 4})} BTC`;
}

/** Year-axis labels: sub-decade spans need a decimal, longer ones do not. */
const yearsLabel = span => y =>
  span < 4 ? `${y.toFixed(1)}y` : `${Math.round(y)}y`;

// ── state in the URL ──────────────────────────────────────────────────────
function readInputs() {
  const num = id => {
    const raw = $(id).value.trim();
    const n = Number(raw);
    return raw === '' || !isFinite(n) ? null : n;
  };
  return {
    btc: num('btc'),
    price: num('price'),
    spend: num('spend'),
    period: $('period').value,
    cagr: num('cagr'),
    inflation: num('inflation'),
    tax: num('tax'),
    basis: num('basis'),
    fees: num('fees'),
    horizon: num('horizon'),
    currency: $('currency').value,
  };
}

function applyState(state) {
  for (const [key, fallback] of Object.entries(FIELDS)) {
    const value = state[key] ?? fallback;
    const node = $(key);
    if (node) node.value = value;
  }
}

function stateFromURL() {
  const q = new URLSearchParams(location.search);
  const state = {};
  for (const key of Object.keys(FIELDS)) {
    if (!q.has(key)) continue;
    const raw = q.get(key);
    state[key] = key === 'period' || key === 'currency' ? raw : Number(raw);
  }
  if (!PERIODS_PER_YEAR[state.period]) delete state.period;
  return state;
}

function writeURL(input) {
  const q = new URLSearchParams();
  for (const key of Object.keys(FIELDS)) {
    const value = input[key];
    if (value !== null && value !== undefined) q.set(key, String(value));
  }
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

// ── charts ────────────────────────────────────────────────────────────────
const btcChart = createChart($('chart-btc'));
const valueChart = createChart($('chart-value'));

// ── render ────────────────────────────────────────────────────────────────
function render() {
  const input = readInputs();
  currency = input.currency;

  const required = ['btc', 'price', 'spend', 'cagr', 'inflation', 'tax', 'basis', 'fees', 'horizon'];
  const missing = required.filter(k => input[k] === null);
  for (const k of required) {
    $(k).classList.toggle('invalid', input[k] === null);
  }
  if (missing.length) {
    $('hero-figure').textContent = '—';
    $('hero-note').textContent = 'Fill in every field to see a projection.';
    return;
  }

  const result = project({
    btc: input.btc,
    price: input.price,
    spendAmount: input.spend,
    spendPeriod: input.period,
    cagr: input.cagr,
    inflation: input.inflation,
    taxRate: input.tax,
    costBasis: input.basis,
    feeRate: input.fees,
    horizonYears: input.horizon,
  });

  writeURL(input);
  renderHero(result, input);
  renderTiles(result, input);
  renderCharts(result, input);
  renderTable(result);
}

function renderHero(r, input) {
  const hero = document.querySelector('.hero');
  const note = $('hero-note');

  if (r.perpetual) {
    hero.classList.add('is-forever');
    $('hero-label').textContent = 'Your stack lasts';
    $('hero-figure').textContent = 'Indefinitely';
    note.innerHTML =
      `At ${input.cagr}% a year the price outruns ${input.inflation}% inflation, so the stack ` +
      `regrows faster than you spend it. You would still hold <strong>${btcAmount(r.endBtc)}</strong> ` +
      `after ${input.horizon} years.`;
    return;
  }

  hero.classList.remove('is-forever');
  if (r.survivesHorizon) {
    $('hero-label').textContent = 'Your stack lasts';
    $('hero-figure').textContent = `Beyond ${input.horizon} years`;
    note.innerHTML =
      `It does not run dry inside the projection, but it is shrinking — ` +
      `<strong>${btcAmount(r.endBtc)}</strong> left at year ${input.horizon}. ` +
      `Extend the horizon to find the end.`;
    return;
  }

  $('hero-label').textContent = 'Your stack lasts';
  $('hero-figure').textContent = formatDuration(r.depletionMonth);
  const end = addMonths(new Date(), r.depletionMonth);
  note.innerHTML =
    `Spending ${money(input.spend)} ${PERIOD_LABEL[input.period]} runs it to zero around ` +
    `<strong>${end.toLocaleDateString(undefined, {month: 'long', year: 'numeric'})}</strong>.`;
}

function renderTiles(r, input) {
  const perLabel = PERIOD_LABEL[input.period];

  if (r.sustainableMonthly > 0) {
    $('t-sustainable').textContent = money(r.sustainableInPeriod);
    $('t-sustainable-note').textContent = `${perLabel}, forever, from ${btcAmount(input.btc)}`;
  } else {
    $('t-sustainable').textContent = 'Nothing';
    $('t-sustainable-note').textContent =
      'Inflation matches or beats the projected CAGR, so no rate is sustainable.';
  }

  if (isFinite(r.requiredBtc)) {
    $('t-required').textContent = btcAmount(r.requiredBtc);
    $('t-required-note').textContent =
      r.requiredBtc <= input.btc
        ? `You hold ${btcAmount(input.btc)} — enough.`
        : `${btcAmount(r.requiredBtc - input.btc)} more than you hold.`;
  } else {
    $('t-required').textContent = '∞';
    $('t-required-note').textContent = 'No finite stack survives inflation at this CAGR.';
  }

  $('t-spent').textContent = moneyCompact(r.spentFiat);
  $('t-spent-note').textContent = `from selling ${btcAmount(r.soldBtc)}`;

  $('t-left').textContent = btcAmount(r.endBtc);
  $('t-left-note').textContent = r.endBtc > 0
    ? `worth ${moneyCompact(r.endValue)} at ${moneyCompact(r.endPrice)}/BTC`
    : 'the stack is spent';
}

function renderCharts(r, input) {
  const endYears = r.series[r.series.length - 1].month / 12;
  const formatX = yearsLabel(endYears);
  const tipYear = p => `Year ${p.x.toFixed(p.x < 10 ? 1 : 0)}`;

  const marker = r.depletionMonth === null
    ? null
    : {x: r.depletionMonth / 12, label: `runs out · ${formatDuration(r.depletionMonth)}`};

  btcChart.update({
    points: r.series.map(p => ({x: p.month / 12, y: p.btc, price: p.price, value: p.value})),
    color: 'var(--series-btc)',
    label: `Bitcoin remaining over ${input.horizon} years`,
    formatY: btcAmount,
    formatX,
    formatTip: p =>
      `<div class="k">${tipYear(p)}</div>` +
      `<div><b>${btcAmount(p.y)}</b></div>` +
      `<div class="k">worth ${money(p.value)}</div>`,
    marker,
  });

  // A surviving stack compounds across orders of magnitude, which a linear
  // axis flattens against the baseline — that case wants a log scale. A
  // depleting stack falls to zero, which a log axis cannot show at all, so it
  // stays linear. The test is growth from the starting value, not the spread
  // across the series: the tail of a depleting run is arbitrarily near zero.
  const points = r.series
    .filter(p => p.value > 0)
    .map(p => ({x: p.month / 12, y: p.value, btc: p.btc, price: p.price}));
  const growth = points.length ? Math.max(...points.map(p => p.y)) / points[0].y : 1;

  valueChart.update({
    points: points.length ? points : [{x: 0, y: 0, btc: 0, price: 0}],
    color: 'var(--series-fiat)',
    scale: growth > 40 ? 'log' : 'linear',
    label: `Stack value over ${input.horizon} years`,
    formatY: moneyCompact,
    formatX,
    formatTip: p =>
      `<div class="k">${tipYear(p)}</div>` +
      `<div><b>${money(p.y)}</b></div>` +
      `<div class="k">${btcAmount(p.btc)} at ${moneyCompact(p.price)}</div>`,
    marker,
  });
}

function renderTable(r) {
  const body = $('table').tBodies[0];
  body.innerHTML = '';
  for (const p of r.series) {
    if (p.month % 12 !== 0) continue;
    const tr = document.createElement('tr');
    for (const cell of [
      String(p.month / 12),
      btcAmount(p.btc),
      money(p.price),
      money(p.value),
    ]) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.append(td);
    }
    body.append(tr);
  }
}

// ── live price ────────────────────────────────────────────────────────────
async function fetchPrice() {
  const note = $('price-note');
  const button = $('fetch-price');
  const code = $('currency').value;
  button.disabled = true;
  note.classList.remove('bad');
  note.textContent = 'Fetching…';

  try {
    const price = await fetchFromMempool(code).catch(() => fetchFromCoinbase(code));
    if (!price) throw new Error('no price returned');
    $('price').value = Math.round(price);
    note.textContent = `Live price: ${money(price)} per BTC, just now.`;
    render();
  } catch (err) {
    note.classList.add('bad');
    note.textContent = `Could not fetch a price (${err.message}). Enter one by hand.`;
  } finally {
    button.disabled = false;
  }
}

async function fetchFromMempool(code) {
  const res = await fetch('https://mempool.space/api/v1/prices');
  if (!res.ok) throw new Error(`mempool ${res.status}`);
  const data = await res.json();
  if (!data[code]) throw new Error(`${code} unavailable`);
  return Number(data[code]);
}

async function fetchFromCoinbase(code) {
  const res = await fetch(`https://api.coinbase.com/v2/prices/BTC-${code}/spot`);
  if (!res.ok) throw new Error(`coinbase ${res.status}`);
  const data = await res.json();
  return Number(data?.data?.amount);
}

// ── info tooltips (hover, focus, tap) ────────────────────────────────────
// The bubble lives on <body> rather than in a ::after, for two reasons: a
// pseudo-element cannot be measured, so it cannot be clamped inside the
// viewport (the leftmost tile's tip was being cut off), and CSS-generated
// content is not reliably announced by screen readers.
const MARGIN = 8;

function initInfoTips() {
  const buttons = [...document.querySelectorAll('.info[data-tip]')];
  let open = null;

  const hide = except => {
    for (const b of buttons) {
      if (b === except) continue;
      b.classList.remove('is-open');
      b.tip.hidden = true;
    }
    if (open && open !== except) open = null;
  };

  const place = button => {
    const tip = button.tip;
    tip.hidden = false;
    const anchor = button.getBoundingClientRect();
    const box = tip.getBoundingClientRect();

    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.min(Math.max(left, MARGIN), window.innerWidth - box.width - MARGIN);

    // Above the icon by default; below it when there is no room above.
    const above = anchor.top - box.height - MARGIN;
    const top = above >= MARGIN ? above : anchor.bottom + MARGIN;

    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };

  buttons.forEach((button, i) => {
    const tip = document.createElement('span');
    tip.className = 'tip';
    tip.role = 'tooltip';
    tip.id = `tip-${i}`;
    tip.textContent = button.dataset.tip;
    tip.hidden = true;
    document.body.append(tip);
    button.tip = tip;
    // Present to assistive tech whether or not the bubble is visible.
    button.setAttribute('aria-describedby', tip.id);

    const show = () => {
      hide(button);
      place(button);
    };
    const dismiss = () => {
      if (open === button) return; // pinned by a tap
      button.classList.remove('is-open');
      tip.hidden = true;
    };

    button.addEventListener('pointerenter', show);
    button.addEventListener('pointerleave', dismiss);
    button.addEventListener('focus', show);
    button.addEventListener('blur', () => {
      open = null;
      button.classList.remove('is-open');
      tip.hidden = true;
    });
    button.addEventListener('click', e => {
      // Inside a <label>, a bare click would forward to the field.
      e.preventDefault();
      e.stopPropagation();
      if (button.classList.toggle('is-open')) {
        open = button;
        show();
      } else {
        open = null;
        tip.hidden = true;
      }
    });
  });

  document.addEventListener('click', () => {
    open = null;
    hide();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    open = null;
    hide();
  });
  window.addEventListener('scroll', () => {
    if (open) place(open);
  }, {passive: true});
}

// ── theme ─────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('brc.theme');
  if (saved) document.documentElement.dataset.theme = saved;
  $('theme').onclick = () => {
    const current =
      document.documentElement.dataset.theme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('brc.theme', next);
  };
}

// ── boot ──────────────────────────────────────────────────────────────────
function boot() {
  applyState(stateFromURL());
  initTheme();
  initInfoTips();

  $('form').addEventListener('input', render);
  $('form').addEventListener('change', render);
  $('form').addEventListener('submit', e => e.preventDefault());
  $('fetch-price').onclick = fetchPrice;

  $('toggle-table').onclick = () => {
    const card = $('table-card');
    const shown = card.classList.toggle('hidden');
    $('toggle-table').setAttribute('aria-expanded', String(!shown));
    $('toggle-table').textContent = shown ? 'Table view' : 'Hide table';
  };

  $('share').onclick = async () => {
    await navigator.clipboard.writeText(location.href);
    $('share').textContent = 'Link copied';
    setTimeout(() => ($('share').textContent = 'Copy shareable link'), 1400);
  };

  $('reset').onclick = () => {
    applyState({});
    render();
  };

  render();
}

boot();
