"use client";

import { useState } from "react";

interface Props {
  value: string;
  label?: string;
  className?: string;
  /** Show the value next to the icon (truncated) */
  showValue?: boolean;
  truncate?: { head: number; tail: number } | false;
  /** "outline" pill button (default) vs "bare" icon-only */
  variant?: "pill" | "bare";
}

function shorten(addr: string, head: number, tail: number) {
  if (!addr || addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function CopyButton({
  value,
  label,
  className = "",
  showValue = false,
  truncate = { head: 6, tail: 4 },
  variant = "pill",
}: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  const display = showValue
    ? truncate === false
      ? value
      : shorten(value, truncate.head, truncate.tail)
    : null;

  const baseClass =
    variant === "pill"
      ? "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2/80 border border-border text-text-muted hover:text-text hover:border-primary/50 transition text-xs font-mono"
      : "inline-flex items-center gap-1 text-text-muted hover:text-text transition text-xs";

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label ?? "Copy"}
      title={copied ? "Copied!" : value}
      className={`${baseClass} ${className}`}
    >
      {showValue && <span>{display}</span>}
      {copied ? (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-success"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
