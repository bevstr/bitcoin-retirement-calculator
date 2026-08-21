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
  url: 'https://example.com/?btc=2&price=80000&spend=4000&period=month&cagr=25&inflation=3&tax=0&horizon=40&currency=USD',
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
assert('horizon from url', $('horizon').value === '40', $('horizon').value);

// The headline must match the model run exactly.
const expected = project({
  btc: 2, price: 80000, spendAmount: 4000, spendPeriod: 'month',
  cagr: 25, inflation: 3, taxRate: 0, horizonYears: 40,
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

// Editing an input must recompute.
const before = $('hero-figure').textContent;
$('spend').value = '400';
$('spend').dispatchEvent(new window.Event('input', {bubbles: true}));
assert('recomputes on input', $('hero-figure').textContent !== before,
  `${before} -> ${$('hero-figure').textContent}`);

// Spending far less than the sustainable rate must never run out.
assert('low spend is perpetual', $('hero-figure').textContent === 'Indefinitely',
  $('hero-figure').textContent);

// A blank required field must not throw, and must say so.
$('btc').value = '';
$('btc').dispatchEvent(new window.Event('input', {bubbles: true}));
assert('handles empty input', $('hero-figure').textContent === '—');
assert('flags the empty field', $('btc').classList.contains('invalid'));
assert('still no uncaught errors', errors.length === 0, errors.join(' | '));

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
