// Boots the built bundle in a DOM and checks the app actually computes,
// renders both charts, and reacts to input.
import {JSDOM, VirtualConsole} from 'jsdom';
import {readFileSync} from 'node:fs';
import {project, formatDuration} from '../src/model.js';

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', e => errors.push(e.message));
virtualConsole.on('error', (...a) => errors.push(a.join(' ')));

const dom = new JSDOM(readFileSync('dist/index.html', 'utf8'), {
  runScripts: 'outside-only',
  url: 'https://example.com/?btc=2&price=80000&spend=4000&period=month&cagr=25&inflation=3&tax=15&basis=20000&fees=1&horizon=40&currency=USD',
  pretendToBeVisual: true,
  virtualConsole,
});
const {window} = dom;
const {document} = window;

// jsdom has no layout engine, so the chart's resize hook needs a stub.
window.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
};

window.eval(readFileSync('dist/app.js', 'utf8').replace(/export\s*\{[^}]*\};?/g, ''));

const $ = id => document.getElementById(id);
const checks = [];
const assert = (name, cond, detail = '') => checks.push([name, !!cond, detail]);

assert('no uncaught errors', errors.length === 0, errors.join(' | '));

// The URL query must drive the form.
assert('btc from url', $('btc').value === '2', $('btc').value);
assert('price from url', $('price').value === '80000', $('price').value);
assert('cagr from url', $('cagr').value === '25', $('cagr').value);
assert('tax from url', $('tax').value === '15', $('tax').value);
assert('basis from url', $('basis').value === '20000', $('basis').value);
assert('fees from url', $('fees').value === '1', $('fees').value);
assert('horizon from url', $('horizon').value === '40', $('horizon').value);

// The headline must match the model run exactly.
const expected = project({
  btc: 2, price: 80000, spendAmount: 4000, spendPeriod: 'month',
  cagr: 25, inflation: 3, taxRate: 15, costBasis: 20000, feeRate: 1, horizonYears: 40,
});
const wantHero = expected.perpetual
  ? 'Indefinitely'
  : expected.survivesHorizon
    ? 'Beyond 40 years'
    : formatDuration(expected.depletionMonth);
assert('hero matches the model', $('hero-figure').textContent === wantHero,
  `${$('hero-figure').textContent} != ${wantHero}`);
assert('hero note is populated', $('hero-note').textContent.length > 20);

// Tiles.
assert('sustainable tile filled', $('t-sustainable').textContent !== '—');
assert('required tile filled', $('t-required').textContent !== '—');
assert('spent tile filled', $('t-spent').textContent !== '—');

// Both charts drew a series path, and neither is a dual-axis plot.
for (const [id, name] of [['chart-btc', 'btc chart'], ['chart-value', 'value chart']]) {
  const svg = $(id).querySelector('svg');
  assert(`${name} rendered`, !!svg);
  assert(`${name} has a series path`, svg?.querySelectorAll('path').length >= 2);
  assert(`${name} has one baseline`, svg?.querySelectorAll('.chart-axis').length === 1);
  assert(`${name} has hairline grid`, svg?.querySelectorAll('.chart-grid').length >= 2);
}

// Table view twin exists and is populated with one row per year.
const rows = $('table').tBodies[0].rows.length;
assert('table populated', rows > 1, `rows=${rows}`);

// A depleting run must include the final 0-BTC row even when it is not a year tick.
$('spend').value = '400000';
$('horizon').value = '10';
$('spend').dispatchEvent(new window.Event('input', {bubbles: true}));
const tableRows = [...$('table').tBodies[0].rows];
const depletionRow = tableRows.find(row => row.cells[1]?.textContent === '0 BTC');
assert('depletion row appears in the table', !!depletionRow,
  tableRows.map(row => `${row.cells[0].textContent}:${row.cells[1].textContent}`).join(' | '));
assert('depletion row shows a fractional year',
  !!(depletionRow && /\.\d/.test(depletionRow.cells[0].textContent)),
  depletionRow?.cells[0].textContent);

// Restore a low spend so the remaining checks still see a recompute.
$('horizon').value = '40';

// Editing an input must recompute.
const before = $('hero-figure').textContent;
$('spend').value = '400';
$('spend').dispatchEvent(new window.Event('input', {bubbles: true}));
assert('recomputes on input', $('hero-figure').textContent !== before,
  `${before} -> ${$('hero-figure').textContent}`);

// Spending far less than the sustainable rate must never run out.
assert('low spend is perpetual', $('hero-figure').textContent === 'Indefinitely',
  $('hero-figure').textContent);

// Live price: Coinbase first, mocked — no real network.
const fetchCalls = [];
window.fetch = async (url) => {
  fetchCalls.push(String(url));
  if (String(url).includes('api.coinbase.com/v2/prices/BTC-USD/spot')) {
    return {ok: true, status: 200, json: async () => ({data: {amount: '99999.6'}})};
  }
  throw new Error(`unexpected fetch ${url}`);
};
const leftBefore = $('t-left-note').textContent;
$('fetch-price').click();
await new Promise((resolve, reject) => {
  const start = Date.now();
  const id = setInterval(() => {
    const text = $('price-note').textContent;
    if (text.startsWith('Live price:')) {
      clearInterval(id);
      resolve();
    } else if ($('price-note').classList.contains('bad')) {
      clearInterval(id);
      reject(new Error(text));
    } else if (Date.now() - start > 2000) {
      clearInterval(id);
      reject(new Error(`timeout: ${text}`));
    }
  }, 10);
});
assert('live price updates the price field', $('price').value === '100000', $('price').value);
assert('live price note includes seconds',
  /\d{1,2}:\d{2}:\d{2}/.test($('price-note').textContent),
  $('price-note').textContent);
assert('live price rerenders', $('t-left-note').textContent !== leftBefore,
  `${leftBefore} -> ${$('t-left-note').textContent}`);
assert('live price used Coinbase only',
  fetchCalls.length === 1 && fetchCalls[0].includes('coinbase') &&
    !fetchCalls.some(u => u.includes('coingecko') || u.includes('mempool')),
  fetchCalls.join(' | '));

// A blank required field must not throw, and must say so.
$('btc').value = '';
$('btc').dispatchEvent(new window.Event('input', {bubbles: true}));
assert('handles empty input', $('hero-figure').textContent === '—');
assert('flags the empty field', $('btc').classList.contains('invalid'));
assert('still no uncaught errors', errors.length === 0, errors.join(' | '));

// Info tooltips on the fields Bevstr asked for.
const tips = [...document.querySelectorAll('button.info[data-tip]')];
assert('info tips present', tips.length >= 8, `count=${tips.length}`);
assert('basis field exists', !!$('basis'));
assert('fees field exists', !!$('fees'));
assert('basis tip mentions lots',
  (document.querySelector('#basis')?.closest('label')?.querySelector('.info')?.dataset.tip || '')
    .includes('acquisition lots'));
assert('tax tip mentions gains',
  (document.querySelector('#tax')?.closest('label')?.querySelector('.info')?.dataset.tip || '')
    .toLowerCase().includes('gains'));
assert('fees tip mentions sale',
  (document.querySelector('#fees')?.closest('label')?.querySelector('.info')?.dataset.tip || '')
    .toLowerCase().includes('sale'));
assert('spent tip is nominal',
  (document.querySelector('#t-spent')?.closest('.tile')?.querySelector('.info')?.dataset.tip || '')
    .toLowerCase().includes('nominal'));
assert('spent label is nominal',
  (document.querySelector('#t-spent')?.closest('.tile')?.querySelector('.tile-label')?.textContent || '')
    .toLowerCase().includes('nominal'));
assert('currency tip mentions cost basis',
  (document.querySelector('#currency')?.closest('label')?.querySelector('.info')?.dataset.tip || '')
    .toLowerCase().includes('cost basis'));
assert('spend-forever tip does not treat CAGR as sufficient',
  (document.querySelector('#t-sustainable')?.closest('.tile')?.querySelector('.info')?.dataset.tip || '')
    .toLowerCase().includes('tax'));
assert('inflation tip explains purchasing power',
  (document.querySelector('#inflation')?.closest('label')?.querySelector('.info')?.dataset.tip || '')
    .toLowerCase().includes('buying power'));
const inflationTip = document.querySelector('#inflation')?.closest('label')?.querySelector('.info');
inflationTip?.dispatchEvent(new window.Event('click', {bubbles: true}));
assert('tip toggles open on click', inflationTip?.classList.contains('is-open'));

// Each tip must be announceable, not only visible: a real element on <body>
// carrying the text, wired to the button with aria-describedby.
const described = tips.every(b => {
  const id = b.getAttribute('aria-describedby');
  const tip = id && document.getElementById(id);
  return tip && tip.parentElement === document.body &&
    tip.textContent === b.dataset.tip && tip.getAttribute('role') === 'tooltip';
});
assert('tips are exposed to assistive tech', described);
assert('tips render outside the cards', document.querySelectorAll('body > .tip').length === tips.length);

const formHtml = $('form').outerHTML;
assert('share lives in the form', formHtml.includes('id="share"'));
assert('reset lives in the form', formHtml.includes('id="reset"'));
assert('share exists once', document.querySelectorAll('#share').length === 1);
assert('reset exists once', document.querySelectorAll('#reset').length === 1);

window.navigator.clipboard = {writeText: async href => { window.__copied = href; }};
$('share').click();
await new Promise(r => setTimeout(r, 0));
assert('copied share link is compact p=1',
  typeof window.__copied === 'string' &&
    window.__copied.includes('?p=1') &&
    !window.__copied.includes('price='),
  String(window.__copied));

const resetFetchesBefore = fetchCalls.length;
$('reset').click();
await new Promise((resolve, reject) => {
  const start = Date.now();
  const id = setInterval(() => {
    const text = $('price-note').textContent;
    if (text.startsWith('Live price:')) {
      clearInterval(id);
      resolve();
    } else if (Date.now() - start > 2000) {
      clearInterval(id);
      reject(new Error(`reset timeout: ${text}`));
    }
  }, 10);
});
assert('reset restores current btc default', $('btc').value === '6.25', $('btc').value);
assert('reset restores current spend default', $('spend').value === '6000', $('spend').value);
assert('reset restores current cagr default', $('cagr').value === '25', $('cagr').value);
assert('reset restores current tax default', $('tax').value === '25', $('tax').value);
assert('reset restores current basis default', $('basis').value === '30000', $('basis').value);
assert('reset restores current fees default', $('fees').value === '0.5', $('fees').value);
assert('reset restores current horizon default', $('horizon').value === '30', $('horizon').value);
assert('reset triggers one live-price fetch',
  fetchCalls.length - resetFetchesBefore === 1,
  `${resetFetchesBefore} -> ${fetchCalls.length}: ${fetchCalls.slice(resetFetchesBefore).join(' | ')}`);
assert('reset session is cleared', window.sessionStorage.getItem('brc.session') === null);

// Fresh visit with no price must auto-fetch once (mocked, no real network).
{
  const autoCalls = [];
  const autoDom = new JSDOM(readFileSync('dist/index.html', 'utf8'), {
    runScripts: 'outside-only',
    url: 'https://example.com/bitcoin-retirement-calculator',
    pretendToBeVisual: true,
    virtualConsole,
  });
  autoDom.window.ResizeObserver ??= class { observe() {} disconnect() {} };
  autoDom.window.fetch = async (url) => {
    autoCalls.push(String(url));
    if (String(url).includes('api.coinbase.com/v2/prices/BTC-USD/spot')) {
      return {ok: true, status: 200, json: async () => ({data: {amount: '123456.7'}})};
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  autoDom.window.eval(readFileSync('dist/app.js', 'utf8').replace(/export\s*\{[^}]*\};?/g, ''));
  await new Promise((resolve, reject) => {
    const start = Date.now();
    const id = setInterval(() => {
      const text = autoDom.window.document.getElementById('price-note').textContent;
      if (text.startsWith('Live price:')) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - start > 2000) {
        clearInterval(id);
        reject(new Error(`auto-fetch timeout: ${text}`));
      }
    }, 10);
  });
  assert('fresh load auto-fetches live price once', autoCalls.length === 1, autoCalls.join(' | '));
  assert('fresh load used Coinbase', autoCalls[0].includes('coinbase'));
  assert('fresh load price field updated',
    autoDom.window.document.getElementById('price').value === '123457',
    autoDom.window.document.getElementById('price').value);
}

// jsdom applies no CSS, so structural assertions alone once let an entirely
// unstyled tooltip ship. Check the built stylesheet actually styles every
// class the scripts create at runtime.
const css = readFileSync('dist/styles.css', 'utf8');
for (const cls of ['tip', 'chart-tip', 'chart-grid', 'chart-axis', 'chart-tick',
                   'chart-cross', 'chart-dot', 'chart-marker', 'chart-marker-label']) {
  assert(`.${cls} is styled in the shipped css`,
    new RegExp(`\\.${cls}\\b[^{]*\\{`).test(css));
}
assert('.tip is positioned', /\.tip\s*\{[^}]*position:\s*fixed/.test(css));
assert('form-actions are styled', /\.form-actions\s*\{/.test(css));
assert('form-actions stack on mobile',
  /@media \(max-width: 480px\)[\s\S]*form-actions/.test(css));
assert('no dead ::after tooltip rules', !/\.info[^{]*::after/.test(css));

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
