"use client";

import { THEME_NAMES, useTheme, type ThemeName } from "./ThemeProvider";

const SWATCHES: Record<ThemeName, { bg: string; ring: string; label: string }> = {
  slate: { bg: "linear-gradient(135deg,#94a3b8,#475569)", ring: "ring-slate-400", label: "Slate" },
  ocean: { bg: "linear-gradient(135deg,#38bdf8,#0369a1)", ring: "ring-sky-400", label: "Ocean" },
  sunset: { bg: "linear-gradient(135deg,#fb923c,#ea580c)", ring: "ring-orange-400", label: "Sunset" },
  forest: { bg: "linear-gradient(135deg,#84cc16,#16a34a)", ring: "ring-green-400", label: "Forest" },
};

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex items-center gap-1 sm:gap-1.5 p-1 sm:p-1.5 rounded-full bg-surface/80 border border-border backdrop-blur-sm">
      {THEME_NAMES.map((t) => {
        const active = t === theme;
        const s = SWATCHES[t];
        return (
          <button
            key={t}
            type="button"
            aria-label={`${s.label} theme`}
            onClick={() => setTheme(t)}
            className={`h-6 w-6 sm:h-7 sm:w-7 rounded-full transition transform ${active ? `scale-110 ring-2 ring-offset-2 ring-offset-surface ${s.ring}` : "opacity-80 hover:opacity-100"}`}
            style={{ background: s.bg }}
          />
        );
      })}
    </div>
  );
}
