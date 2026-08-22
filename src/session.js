// Tab-scoped calculator assumptions. Never stores price — a return visit
// should fetch a fresh live BTC price.

import {stateFromSearch, shouldAutoFetchLivePrice, urlHasCalculatorState} from './share.js';

export const SESSION_KEY = 'brc.session';

export const SESSION_FIELDS = Object.freeze([
  'btc', 'spend', 'period', 'cagr', 'inflation',
  'tax', 'basis', 'fees', 'horizon', 'currency',
]);

function emptyStorage() {
  return {getItem() { return null; }, setItem() {}, removeItem() {}};
}

export function writeSession(input, storage = emptyStorage()) {
  const state = {};
  for (const key of SESSION_FIELDS) {
    const value = input[key];
    if (value === null || value === undefined) continue;
    state[key] = value;
  }
  storage.setItem(SESSION_KEY, JSON.stringify(state));
  return state;
}

export function readSession(storage = emptyStorage()) {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const state = {};
    for (const key of SESSION_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
      const value = parsed[key];
      if (value === null || value === undefined) continue;
      state[key] = key === 'period' || key === 'currency' ? String(value) : Number(value);
    }
    return Object.keys(state).length ? state : null;
  } catch {
    return null;
  }
}

export function clearSession(storage = emptyStorage()) {
  storage.removeItem(SESSION_KEY);
}

/**
 * Boot source for this visit.
 * 1. URL with p=1 or any calculator query field
 * 2. saved session assumptions (never price)
 * 3. current defaults (empty overlay — caller applies FIELDS)
 */
export function resolveInitialState(search, stored) {
  if (urlHasCalculatorState(search)) {
    return {
      source: 'url',
      state: stateFromSearch(search),
      fetchLivePrice: shouldAutoFetchLivePrice(search),
    };
  }
  if (stored && typeof stored === 'object' && Object.keys(stored).length) {
    return {
      source: 'session',
      state: stored,
      fetchLivePrice: true,
    };
  }
  return {
    source: 'defaults',
    state: {},
    fetchLivePrice: true,
  };
}
