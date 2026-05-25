import { createHmac } from "crypto";

/**
 * Fetch account balances from Binance. Requires a READ-ONLY API key (no
 * trade, no withdraw permissions). Returns the non-zero asset balances.
 *
 * Docs: https://binance-docs.github.io/apidocs/spot/en/#account-information-user_data
 */
export interface BinanceBalance {
  asset: string;
  amount: number;
}

export async function fetchBinanceBalances(
  apiKey: string,
  apiSecret: string,
): Promise<BinanceBalance[]> {
  if (!apiKey || !apiSecret) throw new Error("Missing Binance credentials");
  const ts = Date.now();
  const recvWindow = 10000;
  const qs = `timestamp=${ts}&recvWindow=${recvWindow}`;
  const sig = createHmac("sha256", apiSecret).update(qs).digest("hex");
  const url = `https://api.binance.com/api/v3/account?${qs}&signature=${sig}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": apiKey } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    balances: { asset: string; free: string; locked: string }[];
  };
  return (json.balances ?? [])
    .map((b) => ({
      asset: b.asset,
      amount: parseFloat(b.free) + parseFloat(b.locked),
    }))
    .filter((b) => b.amount > 0);
}
