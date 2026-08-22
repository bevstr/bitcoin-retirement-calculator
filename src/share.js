// Compact share links. Preset 1 is a frozen snapshot — not whatever FIELDS
// happens to contain later.

export const PRESET_1 = Object.freeze({
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
});

const PERIODS = new Set(['day', 'week', 'month', 'year']);
const QUERY_KEYS = [
  'btc', 'price', 'spend', 'period', 'cagr', 'inflation',
  'tax', 'basis', 'fees', 'horizon', 'currency',
];

/** Live price auto-fetch runs only when the original URL has no `price`. */
export function shouldAutoFetchLivePrice(search) {
  return !new URLSearchParams(search).has('price');
}

/** True when the URL carries p=1 or any legacy calculator query field. */
export function urlHasCalculatorState(search) {
  const q = new URLSearchParams(search);
  if (q.get('p') === '1') return true;
  return QUERY_KEYS.some(key => q.has(key));
}

/**
 * URL → calculator state. `p=1` seeds preset 1, then explicit params overlay.
 * Price is never implied by the preset.
 */
export function stateFromSearch(search) {
  const q = new URLSearchParams(search);
  const state = {};
  if (q.get('p') === '1') Object.assign(state, PRESET_1);
  for (const key of QUERY_KEYS) {
    if (!q.has(key)) continue;
    const raw = q.get(key);
    state[key] = key === 'period' || key === 'currency' ? raw : Number(raw);
  }
  if (state.period && !PERIODS.has(state.period)) delete state.period;
  return state;
}

/** Query string for Copy shareable link: `p=1` plus fields that differ. Never `price`. */
export function compactShareQuery(input) {
  const q = new URLSearchParams();
  q.set('p', '1');
  for (const [key, preset] of Object.entries(PRESET_1)) {
    const value = input[key];
    if (value === null || value === undefined) continue;
    if (String(value) !== String(preset)) q.set(key, String(value));
  }
  return q;
}

/** Absolute share URL. Trailing slash on the path is stripped. */
export function compactShareURL(input, origin, pathname) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/';
  const url = new URL(path, origin);
  url.search = compactShareQuery(input).toString();
  return url.href;
}
