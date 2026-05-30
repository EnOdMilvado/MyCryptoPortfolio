"use client";

import type { FearGreed, AltcoinSeason } from "@/lib/market/sentiment";

/**
 * Two compact market-sentiment widgets matching the look of CoinMarketCap's
 * homepage cards (the user's reference screenshot):
 *
 *   - FearGreedCard: half-arc gauge with red→orange→yellow→green stops,
 *     a knob marking the current score, big numeric value below, label
 *     ("Fear", "Greed", …) underneath.
 *
 *   - AltSeasonCard: horizontal bar split 25 / 50 / 25 (Bitcoin Season /
 *     neutral / Altcoin Season) using BTC-orange → neutral → ETH-blue,
 *     with a knob at the current index. Big value (e.g. "38/100") and
 *     "Bitcoin" / "Altcoin" anchor labels.
 *
 * Both are pure SVG; no extra deps. Data comes from the server (the
 * dashboard server component fetches and passes it down — clients never
 * hit CMC directly).
 */

interface SentimentCardsProps {
  fearGreed: FearGreed | null;
  altcoinSeason: AltcoinSeason | null;
}

export function SentimentCards({ fearGreed, altcoinSeason }: SentimentCardsProps) {
  return (
    <>
      <FearGreedCard value={fearGreed} />
      <AltSeasonCard value={altcoinSeason} />
    </>
  );
}

/* ---------------- Fear & Greed ---------------- */

function FearGreedCard({ value }: { value: FearGreed | null }) {
  return (
    <div className="card-tight space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold text-text-muted uppercase tracking-wide">
          Fear &amp; Greed
        </span>
        <span className="text-[10px] text-text-muted">CMC</span>
      </div>
      {value ? (
        <div className="flex flex-col items-center pt-1">
          <FearGreedGauge score={value.value} />
          <div className="-mt-3 text-2xl font-extrabold tabular leading-none">
            {value.value}
          </div>
          <div className="mt-0.5 text-[11px] font-semibold text-text-muted">
            {value.label}
          </div>
        </div>
      ) : (
        <div className="text-xs text-text-muted py-6 text-center">No data</div>
      )}
    </div>
  );
}

/**
 * Half-circle gauge. 5 segments (extreme fear → extreme greed) drawn as
 * separate stroked arcs so each gets its own brand color. A small filled
 * knob marks the current score on the arc.
 */
function FearGreedGauge({ score }: { score: number }) {
  // SVG geometry: half-arc spans 180° from (cx-r, cy) to (cx+r, cy).
  const width = 140;
  const height = 78;
  const cx = width / 2;
  const cy = 68;
  const r = 56;
  const strokeW = 9;

  // Map score 0-100 → angle in radians along the upper half-arc.
  // 0 = left (-π/2 from the top), 100 = right (+π/2 from the top), but
  // measured around the bottom-anchored circle: score=0 is at angle π
  // and score=100 at angle 0. We sweep clockwise.
  const angleAt = (s: number) => Math.PI - (s / 100) * Math.PI;
  const pointAt = (s: number) => ({
    x: cx + r * Math.cos(angleAt(s)),
    y: cy - r * Math.sin(angleAt(s)),
  });

  // 5 colored segments: 0-20 red, 20-40 orange, 40-60 yellow,
  // 60-80 light-green, 80-100 green. Same band layout as CMC.
  const segments: { from: number; to: number; color: string }[] = [
    { from: 0, to: 20, color: "#EA3943" },
    { from: 20, to: 40, color: "#EA8C00" },
    { from: 40, to: 60, color: "#F3D42F" },
    { from: 60, to: 80, color: "#93D900" },
    { from: 80, to: 100, color: "#16C784" },
  ];

  const knob = pointAt(Math.max(0, Math.min(100, score)));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`Fear and Greed score ${score}`}
      role="img"
    >
      {segments.map((seg, i) => {
        const a = pointAt(seg.from);
        const b = pointAt(seg.to);
        // Each segment is <180° so large-arc-flag = 0; sweep-flag = 0 to
        // draw the upper arc (CCW relative to SVG's flipped y-axis).
        return (
          <path
            key={i}
            d={`M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`}
            stroke={seg.color}
            strokeWidth={strokeW}
            fill="none"
            strokeLinecap="round"
          />
        );
      })}
      {/* Knob: a small dark dot with a white halo so it reads against any band */}
      <circle cx={knob.x} cy={knob.y} r={6} fill="rgb(var(--surface))" />
      <circle cx={knob.x} cy={knob.y} r={4} fill="rgb(var(--text))" />
    </svg>
  );
}

/* ---------------- Altcoin Season ---------------- */

function AltSeasonCard({ value }: { value: AltcoinSeason | null }) {
  return (
    <div className="card-tight space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold text-text-muted uppercase tracking-wide">
          Altcoin Season
        </span>
        <span className="text-[10px] text-text-muted">CMC</span>
      </div>
      {value ? (
        <>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-extrabold tabular leading-none">
              {value.value}
            </span>
            <span className="text-sm text-text-muted">/100</span>
            {value.label && (
              <span className="ml-auto text-[11px] font-semibold text-text-muted">
                {value.label}
              </span>
            )}
          </div>
          <AltSeasonBar score={value.value} />
          <div className="flex justify-between text-[10px] font-medium text-text-muted">
            <span>Bitcoin</span>
            <span>Altcoin</span>
          </div>
        </>
      ) : (
        <div className="text-xs text-text-muted py-6 text-center">No data</div>
      )}
    </div>
  );
}

/**
 * Horizontal three-zone bar:
 *   0–25   Bitcoin Season (orange #F7931A → light orange fade)
 *   25–75  Neutral (light grey/blue band)
 *   75–100 Altcoin Season (light blue → ETH blue #627EEA)
 *
 * Knob marks the current score. Heights stay small so the card matches
 * the height of the F&G gauge card next to it.
 */
function AltSeasonBar({ score }: { score: number }) {
  const width = 140;
  const height = 14;
  const radius = 4;
  const knobX = (Math.max(0, Math.min(100, score)) / 100) * width;
  const knobY = height / 2;

  // Three zones as rectangles. The middle zone uses a neutral surface color
  // tuned to read fine on both light and dark themes (the brand colors at
  // each end are vivid enough that the middle should be subtle).
  return (
    <svg
      width="100%"
      height={height + 8}
      viewBox={`0 0 ${width} ${height + 8}`}
      preserveAspectRatio="none"
      aria-label={`Altcoin season index ${score} of 100`}
      role="img"
      className="block"
    >
      <defs>
        <linearGradient id="alt-bar-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#F7931A" />
          <stop offset="25%" stopColor="#F6CFA0" />
          <stop offset="50%" stopColor="#D8E0F0" />
          <stop offset="75%" stopColor="#A8B6E8" />
          <stop offset="100%" stopColor="#627EEA" />
        </linearGradient>
      </defs>
      <rect
        x="0"
        y={4}
        width={width}
        height={height}
        rx={radius}
        fill="url(#alt-bar-grad)"
      />
      {/* Knob */}
      <circle cx={knobX} cy={knobY + 4} r={7} fill="rgb(var(--surface))" />
      <circle cx={knobX} cy={knobY + 4} r={5} fill="rgb(var(--text))" />
    </svg>
  );
}
