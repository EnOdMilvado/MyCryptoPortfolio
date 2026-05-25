"use client";

export interface TabDef {
  key: string;
  label: string;
  badge?: string | number;
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-2 border border-border overflow-x-auto max-w-full"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition whitespace-nowrap ${
              isActive
                ? "bg-primary text-white shadow-pill"
                : "text-text-muted hover:text-text"
            }`}
          >
            {t.label}
            {t.badge != null && (
              <span
                className={`ml-1.5 text-xs ${
                  isActive ? "opacity-80" : "opacity-70"
                }`}
              >
                ({t.badge})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
