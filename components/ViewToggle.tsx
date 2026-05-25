"use client";

export type ViewMode = "grid" | "list";

export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-surface-2 border border-border">
      <button
        type="button"
        onClick={() => onChange("grid")}
        aria-pressed={value === "grid"}
        aria-label="Grid view"
        title="Grid view"
        className={`p-1.5 rounded-full transition ${
          value === "grid" ? "bg-primary text-white" : "text-text-muted hover:text-text"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-pressed={value === "list"}
        aria-label="List view"
        title="List view"
        className={`p-1.5 rounded-full transition ${
          value === "list" ? "bg-primary text-white" : "text-text-muted hover:text-text"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export function ReorderButtons({
  onUp,
  onDown,
  isFirst,
  isLast,
}: {
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isFirst) onUp();
        }}
        disabled={isFirst}
        aria-label="Move up"
        title="Move up"
        className="h-6 w-6 rounded-full bg-surface-2 border border-border inline-flex items-center justify-center disabled:opacity-30 hover:bg-primary/15 transition"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isLast) onDown();
        }}
        disabled={isLast}
        aria-label="Move down"
        title="Move down"
        className="h-6 w-6 rounded-full bg-surface-2 border border-border inline-flex items-center justify-center disabled:opacity-30 hover:bg-primary/15 transition"
      >
        ↓
      </button>
    </div>
  );
}

export function EditButton({
  editing,
  onToggle,
}: {
  editing: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`btn-ghost text-xs ${editing ? "bg-primary/15 text-primary" : ""}`}
      title={editing ? "Done editing" : "Reorder items"}
    >
      {editing ? "✓ Done" : "✎ Edit order"}
    </button>
  );
}

/**
 * Persists a UI choice (e.g. "grid" / "list") in localStorage. Safe SSR —
 * returns the default on the server.
 */
export function readViewMode(storageKey: string, fallback: ViewMode = "grid"): ViewMode {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(storageKey);
    if (v === "grid" || v === "list") return v;
  } catch {}
  return fallback;
}

export function writeViewMode(storageKey: string, value: ViewMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {}
}
