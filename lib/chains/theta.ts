import {
  NATIVE_DECIMALS,
  NATIVE_SYMBOL,
  type Holding,
} from "./types";
import { getNativePricesWithChange } from "./prices";

/**
 * Theta holdings via the public Theta Labs JSON-RPC.
 *
 *   POST /rpc { method: "theta.GetAccount", params: [{ address }] }
 *
 * Theta is a dual-token chain: every account holds both THETA (governance,
 * coingecko id: theta-token) and TFUEL (gas/utility, coingecko id:
 * theta-fuel). Both come back in the same response as wei-style integer
 * strings under coins.thetawei / coins.tfuelwei, so we surface them as
 * two separate holdings.
 *
 * Addresses are 0x-prefixed 40-hex strings identical in shape to EVM
 * addresses — the AddWalletDialog has to let the user pick "Theta" when
 * adding so we don't classify a Theta wallet as EVM.
 */
const RPC = "https://theta-bridge-rpc.thetatoken.org/rpc";

interface ThetaAccountResp {
  jsonrpc: string;
  id: number;
  result?: {
    coins?: {
      thetawei?: string;
      tfuelwei?: string;
    };
  };
  error?: {
    code?: number;
    message?: string;
  };
}

async function getThetaAccount(address: string): Promise<{
  theta: number;
  tfuel: number;
}> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "theta.GetAccount",
      params: [{ address }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Theta RPC ${res.status}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as ThetaAccountResp;
  if (json.error) {
    // "Account not found" is the chain's way of saying balance is zero
    // for an address that has never received funds — treat as zero.
    if (
      typeof json.error.message === "string" &&
      /not found/i.test(json.error.message)
    ) {
      return { theta: 0, tfuel: 0 };
    }
    throw new Error(
      `Theta RPC error: ${json.error.message ?? JSON.stringify(json.error)}`,
    );
  }
  const wei = json.result?.coins ?? {};
  const decimals = NATIVE_DECIMALS.theta;
  const scale = 10 ** decimals;
  const theta = parseFloat(wei.thetawei ?? "0") / scale;
  const tfuel = parseFloat(wei.tfuelwei ?? "0") / scale;
  return {
    theta: Number.isFinite(theta) ? theta : 0,
    tfuel: Number.isFinite(tfuel) ? tfuel : 0,
  };
}

export async function fetchThetaHoldings(address: string): Promise<Holding[]> {
  const [{ theta, tfuel }, cg] = await Promise.all([
    getThetaAccount(address),
    getNativePricesWithChange(["theta-token", "theta-fuel"]),
  ]);
  const out: Holding[] = [];

  const thetaPx = cg["theta-token"]?.usd ?? null;
  const thetaChg = cg["theta-token"]?.change24h ?? null;
  if (theta > 0) {
    out.push({
      chain: "theta",
      contract: "native",
      symbol: NATIVE_SYMBOL.theta,
      name: "Theta Network",
      amount: theta,
      decimals: NATIVE_DECIMALS.theta,
      priceUsd: thetaPx,
      valueUsd: thetaPx ? theta * thetaPx : 0,
      priceChange24h: thetaChg,
    });
  }

  const tfuelPx = cg["theta-fuel"]?.usd ?? null;
  const tfuelChg = cg["theta-fuel"]?.change24h ?? null;
  if (tfuel > 0) {
    out.push({
      chain: "theta",
      // Use a stable synthetic contract id so the cache treats TFUEL as
      // distinct from native THETA on the same wallet.
      contract: "tfuel",
      symbol: "TFUEL",
      name: "Theta Fuel",
      amount: tfuel,
      decimals: NATIVE_DECIMALS.theta,
      priceUsd: tfuelPx,
      valueUsd: tfuelPx ? tfuel * tfuelPx : 0,
      priceChange24h: tfuelChg,
    });
  }

  return out;
}
