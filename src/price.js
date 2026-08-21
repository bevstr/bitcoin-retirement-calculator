// Live BTC price providers. Coinbase first, CoinGecko if that fails.

function requirePositivePrice(value, source) {
  const price = Number(value);
  if (!isFinite(price) || price <= 0) throw new Error(`${source} price invalid`);
  return price;
}

export async function fetchFromCoinbase(code, fetchFn = fetch) {
  const res = await fetchFn(`https://api.coinbase.com/v2/prices/BTC-${code}/spot`);
  if (!res.ok) throw new Error(`coinbase ${res.status}`);
  const data = await res.json();
  return requirePositivePrice(data?.data?.amount, 'coinbase');
}

export async function fetchFromCoinGecko(code, fetchFn = fetch) {
  const vs = String(code).toLowerCase();
  const url =
    `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${encodeURIComponent(vs)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const data = await res.json();
  if (!data?.bitcoin || !Object.prototype.hasOwnProperty.call(data.bitcoin, vs)) {
    throw new Error(`${code} unavailable`);
  }
  return requirePositivePrice(data.bitcoin[vs], 'coingecko');
}

/** Coinbase, then CoinGecko. Throws if both fail. */
export async function fetchLivePrice(code, fetchFn = fetch) {
  try {
    return await fetchFromCoinbase(code, fetchFn);
  } catch {
    return await fetchFromCoinGecko(code, fetchFn);
  }
}

/** Success copy: local time of this browser receive, including seconds. */
export function livePriceNote(formattedMoney, at = new Date()) {
  const time = at.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
  return `Live price: ${formattedMoney} per BTC · fetched ${time}`;
}
