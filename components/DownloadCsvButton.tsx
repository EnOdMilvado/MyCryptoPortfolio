"use client";

interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

interface Props<T> {
  filename: string;
  rows: T[];
  columns: CsvColumn<T>[];
  disabled?: boolean;
  label?: string;
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsv(c.header)).join(","));
  for (const r of rows) {
    const cells = columns.map((c) => {
      const v = c.value(r);
      if (v == null) return "";
      return escapeCsv(String(v));
    });
    lines.push(cells.join(","));
  }
  return lines.join("\r\n");
}

/**
 * Generates a CSV blob client-side and triggers a download. Adds a UTF-8 BOM
 * so Microsoft Excel reads non-ASCII characters correctly.
 */
export function DownloadCsvButton<T>({
  filename,
  rows,
  columns,
  disabled,
  label = "Download CSV",
}: Props<T>) {
  function onClick() {
    const csv = buildCsv(rows, columns);
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || rows.length === 0}
      className="btn-ghost"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {label}
    </button>
  );
}
