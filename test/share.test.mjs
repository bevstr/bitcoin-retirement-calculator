import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESET_1,
  compactShareQuery,
  compactShareURL,
  stateFromSearch,
  shouldAutoFetchLivePrice,
} from '../src/share.js';

const ORIGIN = 'https://bevstr.github.io';
const PATH = '/bitcoin-retirement-calculator';

const defaults = {
  ...PRESET_1,
  price: 107789,
};

test('current defaults match preset 1 plus price fallback', () => {
  assert.equal(PRESET_1.btc, 6.25);
  assert.equal(PRESET_1.spend, 6000);
  assert.equal(PRESET_1.period, 'month');
  assert.equal(PRESET_1.cagr, 25);
  assert.equal(PRESET_1.inflation, 3);
  assert.equal(PRESET_1.tax, 25);
  assert.equal(PRESET_1.basis, 30000);
  assert.equal(PRESET_1.fees, 0.5);
  assert.equal(PRESET_1.horizon, 30);
  assert.equal(PRESET_1.currency, 'USD');
  assert.equal('price' in PRESET_1, false);
});

test('fresh load without price auto-fetches live price', () => {
  assert.equal(shouldAutoFetchLivePrice(''), true);
  assert.equal(shouldAutoFetchLivePrice('?p=1'), true);
  assert.equal(shouldAutoFetchLivePrice('?btc=8'), true);
});

test('explicit price suppresses auto-fetch', () => {
  assert.equal(shouldAutoFetchLivePrice('?price=80000'), false);
  assert.equal(shouldAutoFetchLivePrice('?btc=2&price=80000&spend=5000'), false);
});

test('p=1 default share link contains only p=1', () => {
  const href = compactShareURL(defaults, ORIGIN, PATH);
  assert.equal(href, 'https://bevstr.github.io/bitcoin-retirement-calculator?p=1');
  assert.equal(compactShareQuery(defaults).toString(), 'p=1');
});

test('changed BTC -> p=1&btc=...', () => {
  const href = compactShareURL({...defaults, btc: 8}, ORIGIN, PATH);
  assert.equal(href, 'https://bevstr.github.io/bitcoin-retirement-calculator?p=1&btc=8');
});

test('changed spend + CAGR include only those overrides', () => {
  const href = compactShareURL({...defaults, btc: 8, spend: 7500, cagr: 20}, ORIGIN, PATH);
  assert.equal(
    href,
    'https://bevstr.github.io/bitcoin-retirement-calculator?p=1&btc=8&spend=7500&cagr=20',
  );
});

test('price is never included in compact share links', () => {
  const q = compactShareQuery({...defaults, price: 80000, btc: 8});
  assert.equal(q.has('price'), false);
  assert.equal(q.get('p'), '1');
  assert.equal(q.get('btc'), '8');
});

test('loading p=1 restores PRESET_1', () => {
  const state = stateFromSearch('?p=1');
  assert.deepEqual(state, {...PRESET_1});
  assert.equal('price' in state, false);
});

test('explicit p=1 overrides beat preset', () => {
  const state = stateFromSearch('?p=1&btc=8&spend=7500&cagr=20&currency=AUD');
  assert.equal(state.btc, 8);
  assert.equal(state.spend, 7500);
  assert.equal(state.cagr, 20);
  assert.equal(state.currency, 'AUD');
  assert.equal(state.tax, PRESET_1.tax);
  assert.equal(state.basis, PRESET_1.basis);
});

test('legacy full URLs without p=1 still work', () => {
  const search =
    '?btc=2&price=80000&spend=5000&period=month&cagr=25&inflation=3&tax=15&basis=20000&fees=1&horizon=40&currency=USD';
  const state = stateFromSearch(search);
  assert.equal(state.btc, 2);
  assert.equal(state.price, 80000);
  assert.equal(state.spend, 5000);
  assert.equal(state.tax, 15);
  assert.equal(state.horizon, 40);
});

test('copied link is an absolute GitHub Pages URL', () => {
  const href = compactShareURL(defaults, ORIGIN, '/bitcoin-retirement-calculator/');
  assert.equal(href.startsWith('https://bevstr.github.io/'), true);
  assert.equal(href.includes('21bitty.com'), false);
  assert.equal(href, 'https://bevstr.github.io/bitcoin-retirement-calculator?p=1');
});

test('preset 1 is a frozen snapshot, not a live alias of later defaults', () => {
  assert.equal(Object.isFrozen(PRESET_1), true);
  assert.equal('price' in PRESET_1, false);
});
