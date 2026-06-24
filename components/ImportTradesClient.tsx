"use client";

import { useMemo, useState } from "react";

export interface ImportExchange {
  id: string;
  provider: string;
  label: string;
}

/* ------------------------------ CSV parsing ------------------------------ */

/** Minimal RFC-4180-ish CSV parser (handles quotes, commas, newlines). */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const t = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((x) => x.trim() !== "")) rows.push(row);
  }
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

/* ----------------------------- field mapping ----------------------------- */

type Field =
  | "date"
  | "side"
  | "pair"
  | "base"
  | "quote"
  | "qty"
  | "price"
  | "total"
  | "fee"
  | "feeAsset";

const FIELD_LABEL: Record<Field, string> = {
  date: "Date / time *",
  side: "Side (buy/sell) *",
  pair: "Pair (e.g. BTC/USDT)",
  base: "Base asset (the coin)",
  quote: "Quote asset",
  qty: "Quantity (of coin) *",
  price: "Price",
  total: "Total (quote amount)",
  fee: "Fee",
  feeAsset: "Fee asset",
};

const GUESS: Record<Field, RegExp> = {
  date: /date|time|executed|created|fill|trade.?time/i,
  side: /\bside\b|type|direction|action|buy\/?sell|b\/s/i,
  pair: /pair|symbol|market|instrument|contract/i,
  base: /base|coin|^asset|currency$/i,
  quote: /quote/i,
  qty: /qty|quantity|amount|filled|size|executed.?amount|volume/i,
  price: /price|rate|avg/i,
  total: /total|quote.?qty|quote.?amount|value|cost|funds|turnover/i,
  fee: /^fee$|fee.?paid|commission/i,
  feeAsset: /fee.?(asset|coin|currency|unit)/i,
};

const KNOWN_QUOTES = [
  "USDT",
  "USDC",
  "USD",
  "BUSD",
  "DAI",
  "FDUSD",
  "TUSD",
  "BTC",
  "ETH",
  "BNB",
  "EUR",
  "TRY",
];

function splitPair(pair: string): { base: string; quote: string } {
  const p = pair.trim().toUpperCase();
  const m = p.split(/[/_\-:\s]/).filter(Boolean);
  if (m.length >= 2) return { base: m[0], quote: m[1] };
  for (const q of KNOWN_QUOTES) {
    if (p.endsWith(q) && p.length > q.length) {
      return { base: p.slice(0, -q.length), quote: q };
    }
  }
  return { base: p, quote: "" };
}

function parseDate(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  // pure number → epoch (seconds or milliseconds)
  if (/^\d{10,13}$/.test(v)) {
    const n = Number(v);
    const ms = v.length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(v.replace(" ", "T"));
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const d2 = new Date(v);
  return Number.isNaN(d2.getTime()) ? null : d2.toISOString();
}

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/[, ]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface ParsedTrade {
  executed_at: string;
  side: string;
  base_asset: string;
  quote_asset: string;
  qty: number;
  price: number | null;
  quote_qty: number | null;
  fee: number | null;
  fee_asset: string | null;
}

function buildTrade(
  cells: string[],
  map: Record<Field, number>,
): ParsedTrade | null {
  const get = (f: Field) => (map[f] >= 0 ? cells[map[f]] : undefined);
  const dateRaw = get("date");
  const executed_at = dateRaw ? parseDate(dateRaw) : null;
  if (!executed_at) return null;

  let base = (get("base") ?? "").trim().toUpperCase();
  let quote = (get("quote") ?? "").trim().toUpperCase();
  const pairRaw = get("pair");
  if ((!base || !quote) && pairRaw) {
    const sp = splitPair(pairRaw);
    base = base || sp.base;
    quote = quote || sp.quote;
  }
  if (!base) return null;

  const sideRaw = (get("side") ?? "").trim().toLowerCase();
  const side = /sell|^s$|卖|short/.test(sideRaw) ? "sell" : "buy";

  const qty = num(get("qty"));
  if (qty == null || qty <= 0) return null;
  const price = num(get("price"));
  const total = num(get("total"));

  return {
    executed_at,
    side,
    base_asset: base,
    quote_asset: quote,
    qty,
    price,
    quote_qty: total != null ? total : price != null ? qty * price : null,
    fee: num(get("fee")),
    fee_asset: (get("feeAsset") ?? "").trim().toUpperCase() || null,
  };
}

/* ------------------------------- component ------------------------------- */

export function ImportTradesClient({
  exchanges,
}: {
  exchanges: ImportExchange[];
}) {
  const [exchangeId, setExchangeId] = useState(exchanges[0]?.id ?? "");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<Record<Field, number>>(emptyMap());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setError(null);
    const text = await file.text();
    const { headers: h, rows: r } = parseCsv(text);
    setHeaders(h);
    setRows(r);
    setFileName(file.name);
    setMap(autoMap(h));
  }

  const preview = useMemo(() => {
    if (headers.length === 0) return [];
    return rows
      .slice(0, 6)
      .map((cells) => buildTrade(cells, map))
      .filter((t): t is ParsedTrade => t !== null);
  }, [rows, map, headers]);

  const validCount = useMemo(() => {
    return rows.reduce(
      (n, cells) => (buildTrade(cells, map) ? n + 1 : n),
      0,
    );
  }, [rows, map]);

  const hasRequired =
    map.date >= 0 && map.side >= 0 && map.qty >= 0 && (map.base >= 0 || map.pair >= 0);

  async function doImport() {
    if (!exchangeId) {
      setError("Pick an exchange first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const trades = rows
        .map((cells) => buildTrade(cells, map))
        .filter((t): t is ParsedTrade => t !== null);
      if (trades.length === 0) throw new Error("No valid rows with this mapping.");
      const res = await fetch("/api/exchanges/import-trades", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exchangeId, trades }),
      });
      const json = (await res.json()) as { imported?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      setResult(
        `Imported ${json.imported} trades. They now feed the P&L report.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-text">Import exchange trades (CSV)</h1>
        <p className="text-sm text-text-muted mt-1">
          Exchange APIs only return recent history. For older tax years, export
          your full trade history from the exchange and upload it here — then map
          the columns. Re-importing the same file is safe (no duplicates).
        </p>
      </header>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-xs font-semibold text-text-muted">
            Exchange
            <select
              value={exchangeId}
              onChange={(e) => setExchangeId(e.target.value)}
              className="mt-1 px-2 py-1.5 text-sm rounded border border-border bg-surface text-text min-w-[14rem]"
            >
              {exchanges.length === 0 && <option value="">No exchanges</option>}
              {exchanges.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.label} ({ex.provider})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs font-semibold text-text-muted">
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="mt-1 text-sm text-text-muted file:mr-2 file:rounded file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-text"
            />
          </label>
          {fileName && (
            <span className="text-xs text-text-muted">
              {fileName} · {rows.length} rows
            </span>
          )}
        </div>
      </section>

      {headers.length > 0 && (
        <>
          <section className="card space-y-3">
            <h2 className="text-sm font-bold text-text">Map columns</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(Object.keys(FIELD_LABEL) as Field[]).map((f) => (
                <label key={f} className="flex flex-col text-xs text-text-muted">
                  {FIELD_LABEL[f]}
                  <select
                    value={map[f]}
                    onChange={(e) =>
                      setMap((m) => ({ ...m, [f]: Number(e.target.value) }))
                    }
                    className="mt-1 px-2 py-1.5 text-sm rounded border border-border bg-surface text-text"
                  >
                    <option value={-1}>— none —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-xs text-text-muted">
              * required. Provide either a single <b>Pair</b> column, or separate{" "}
              <b>Base</b> + <b>Quote</b>. Price or Total is recommended for P&amp;L
              value.
            </p>
          </section>

          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-text">
                Preview ·{" "}
                <span className="text-text-muted font-normal">
                  {validCount}/{rows.length} rows parse with this mapping
                </span>
              </h2>
              <button
                type="button"
                onClick={doImport}
                disabled={busy || !hasRequired || validCount === 0}
                className="btn-primary text-sm"
              >
                {busy ? "Importing…" : `Import ${validCount} trades`}
              </button>
            </div>
            {!hasRequired && (
              <p className="text-xs text-amber-500">
                Map at least Date, Side, Quantity, and Base (or Pair).
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-text-muted">
                  <tr>
                    {["Date", "Side", "Base", "Quote", "Qty", "Price", "Total", "Fee"].map(
                      (h) => (
                        <th key={h} className="px-2 py-1 text-left font-semibold">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((t, i) => (
                    <tr key={i} className={i % 2 ? "bg-surface-2/30" : ""}>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {t.executed_at.slice(0, 19).replace("T", " ")}
                      </td>
                      <td
                        className={`px-2 py-1 font-semibold ${t.side === "sell" ? "text-danger" : "text-success"}`}
                      >
                        {t.side}
                      </td>
                      <td className="px-2 py-1 font-semibold">{t.base_asset}</td>
                      <td className="px-2 py-1">{t.quote_asset || "—"}</td>
                      <td className="px-2 py-1 tabular">{t.qty}</td>
                      <td className="px-2 py-1 tabular">{t.price ?? "—"}</td>
                      <td className="px-2 py-1 tabular">{t.quote_qty ?? "—"}</td>
                      <td className="px-2 py-1 tabular">{t.fee ?? "—"}</td>
                    </tr>
                  ))}
                  {preview.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-2 py-4 text-center text-text-muted">
                        No rows parse yet — check the Date / Side / Quantity / Base
                        mapping.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {result && (
        <p className="card bg-success/10 text-success text-sm">{result}</p>
      )}
      {error && <p className="card bg-danger/10 text-danger text-sm">{error}</p>}
    </div>
  );
}

function emptyMap(): Record<Field, number> {
  return {
    date: -1,
    side: -1,
    pair: -1,
    base: -1,
    quote: -1,
    qty: -1,
    price: -1,
    total: -1,
    fee: -1,
    feeAsset: -1,
  };
}

function autoMap(headers: string[]): Record<Field, number> {
  const m = emptyMap();
  const used = new Set<number>();
  for (const f of Object.keys(GUESS) as Field[]) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      if (GUESS[f].test(headers[i])) {
        m[f] = i;
        used.add(i);
        break;
      }
    }
  }
  return m;
}
