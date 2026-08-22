import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRESET_1, compactShareQuery, compactShareURL, stateFromSearch} from '../src/share.js';
import {
  SESSION_KEY,
  clearSession,
  readSession,
  resolveInitialState,
  writeSession,
} from '../src/session.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

const CURRENT_DEFAULTS = {
  btc: 6.25,
  spend: 6000,
  period: 'month',
  cagr: 25,
  inflation: 3,
  tax: 25,
  basis: 30000,
  fees: 0.5,
  horizon: 30,
  currency: 'USD',
};

const saved = {
  btc: 8,
  spend: 6000,
  period: 'month',
  cagr: 20,
  inflation: 3,
  tax: 25,
  basis: 30000,
  fees: 0.5,
  horizon: 30,
  currency: 'USD',
};

test('session assumptions persist and do not store price', () => {
  const storage = memoryStorage();
  const written = writeSession({...saved, price: 99999, evil: 'nope'}, storage);
  assert.equal('price' in written, false);
  assert.equal('evil' in written, false);
  const raw = JSON.parse(storage.getItem(SESSION_KEY));
  assert.equal(raw.btc, 8);
  assert.equal(raw.cagr, 20);
  assert.equal('price' in raw, false);
  assert.deepEqual(readSession(storage), written);
});

test('returning with no calculator query restores saved session assumptions', () => {
  const boot = resolveInitialState('', saved);
  assert.equal(boot.source, 'session');
  assert.equal(boot.state.btc, 8);
  assert.equal(boot.state.cagr, 20);
  assert.equal(boot.fetchLivePrice, true);
  assert.equal('price' in boot.state, false);
});

test('URL state beats session state', () => {
  const p1 = resolveInitialState('?p=1', saved);
  assert.equal(p1.source, 'url');
  assert.equal(p1.state.btc, PRESET_1.btc);
  assert.equal(p1.fetchLivePrice, true);

  const overlay = resolveInitialState('?p=1&btc=10', saved);
  assert.equal(overlay.state.btc, 10);
  assert.equal(overlay.state.cagr, PRESET_1.cagr);

  const legacy = resolveInitialState(
    '?btc=2&price=80000&spend=5000&period=month&cagr=25&inflation=3&tax=15&basis=20000&fees=1&horizon=40&currency=USD',
    saved,
  );
  assert.equal(legacy.source, 'url');
  assert.equal(legacy.state.btc, 2);
  assert.equal(legacy.state.price, 80000);
  assert.equal(legacy.fetchLivePrice, false);
});

test('corrupt session does not break boot', () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, '{not json');
  assert.equal(readSession(storage), null);
  const boot = resolveInitialState('', readSession(storage));
  assert.equal(boot.source, 'defaults');
  assert.equal(boot.fetchLivePrice, true);

  storage.setItem(SESSION_KEY, JSON.stringify({btc: 8, __proto__: {polluted: true}, price: 1}));
  const cleaned = readSession(storage);
  assert.equal(cleaned.btc, 8);
  assert.equal('price' in cleaned, false);
});

test('Reset clears session and restores current defaults', () => {
  const storage = memoryStorage();
  writeSession(saved, storage);
  clearSession(storage);
  assert.equal(readSession(storage), null);
  const boot = resolveInitialState('', readSession(storage));
  assert.equal(boot.source, 'defaults');
  assert.deepEqual({...CURRENT_DEFAULTS, ...boot.state}, CURRENT_DEFAULTS);
  assert.equal(boot.fetchLivePrice, true);
});

test('compact share still omits price after session changes', () => {
  const input = {...PRESET_1, price: 107789, btc: 8, spend: 7500, cagr: 20};
  assert.equal(
    compactShareURL(input, 'https://bevstr.github.io', '/bitcoin-retirement-calculator'),
    'https://bevstr.github.io/bitcoin-retirement-calculator?p=1&btc=8&spend=7500&cagr=20',
  );
  assert.equal(compactShareQuery(input).has('price'), false);
  assert.equal(stateFromSearch('?p=1&btc=10').btc, 10);
});

test('Share and Reset exist once, inside the assumptions card', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/id="share"/g) || []).length, 1);
  assert.equal((html.match(/id="reset"/g) || []).length, 1);
  const form = html.slice(html.indexOf('<form class="card" id="form"'), html.indexOf('</form>') + 7);
  assert.match(form, /id="share"/);
  assert.match(form, /id="reset"/);
  assert.match(form, /form-actions/);
  const feesIdx = form.lastIndexOf('Selling fees');
  const shareIdx = form.indexOf('id="share"');
  assert.ok(shareIdx > feesIdx);
  const footer = html.slice(html.indexOf('<footer class="ft">'));
  assert.equal(footer.includes('id="share"'), false);
});
