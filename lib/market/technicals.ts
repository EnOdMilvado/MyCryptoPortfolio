export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    const diff = cur - prev;
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (gains === 0 && losses === 0) return 50;
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function piCycleSignal(price: number, ma111x2: number | null, ma350: number | null) {
  return {
    price,
    ma111x2,
    ma350,
    overheated: ma111x2 != null && ma350 != null ? price > ma111x2 && price > ma350 : null,
  };
}
