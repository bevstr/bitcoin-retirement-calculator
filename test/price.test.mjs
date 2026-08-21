import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchLivePrice, fetchFromCoinGecko, livePriceNote} from '../src/price.js';

function jsonOk(body) {
  return {ok: true, status: 200, json: async () => body};
}

function httpErr(status) {
  return {ok: false, status, json: async () => ({})};
}

test('Coinbase success is used without calling CoinGecko', async () => {
  const urls = [];
  const price = await fetchLivePrice('AUD', async url => {
    urls.push(String(url));
    if (String(url).includes('api.coinbase.com')) {
      return jsonOk({data: {amount: '107789.4'}});
    }
    throw new Error(`unexpected ${url}`);
  });
  assert.equal(price, 107789.4);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /api\.coinbase\.com\/v2\/prices\/BTC-AUD\/spot/);
  assert.ok(!urls.some(u => u.includes('coingecko')));
});

test('Coinbase failure causes CoinGecko fallback', async () => {
  const urls = [];
  const price = await fetchLivePrice('EUR', async url => {
    urls.push(String(url));
    if (String(url).includes('coinbase')) return httpErr(503);
    if (String(url).includes('coingecko')) {
      return jsonOk({bitcoin: {eur: 98000}});
    }
    throw new Error(`unexpected ${url}`);
  });
  assert.equal(price, 98000);
  assert.ok(urls.some(u => u.includes('coinbase')));
  assert.ok(urls.some(u => u.includes('coingecko')));
});

test('CoinGecko requests and returns the selected currency', async () => {
  const urls = [];
  const price = await fetchFromCoinGecko('AUD', async url => {
    urls.push(String(url));
    assert.match(String(url), /vs_currencies=aud/);
    return jsonOk({bitcoin: {aud: 111111, usd: 70000}});
  });
  assert.equal(price, 111111);
  assert.equal(urls.length, 1);
});

test('CoinGecko does not silently use another fiat', async () => {
  await assert.rejects(
    () => fetchFromCoinGecko('AUD', async () => jsonOk({bitcoin: {usd: 70000}})),
    /AUD unavailable/,
  );
});

test('invalid Coinbase price causes CoinGecko fallback', async () => {
  const cases = [
    {data: {amount: '0'}},
    {data: {amount: '-1'}},
    {data: {amount: 'nope'}},
    {data: {}},
    {},
  ];
  for (const body of cases) {
    const price = await fetchLivePrice('USD', async url => {
      if (String(url).includes('coinbase')) return jsonOk(body);
      return jsonOk({bitcoin: {usd: 64000}});
    });
    assert.equal(price, 64000, `fallback after ${JSON.stringify(body)}`);
  }
});

test('both providers failing throws', async () => {
  await assert.rejects(
    () => fetchLivePrice('USD', async url => {
      if (String(url).includes('coinbase')) throw new Error('network down');
      return httpErr(429);
    }),
    /coingecko 429/,
  );
});

test('success note includes a fetched time with seconds', () => {
  const note = livePriceNote('$107,789', new Date(2020, 0, 1, 21, 48, 22));
  assert.match(note, /^Live price: \$107,789 per BTC · fetched /);
  assert.match(note, /\d{1,2}:\d{2}:\d{2}/);
});
