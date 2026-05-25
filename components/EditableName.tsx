"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A click-to-edit text label. Outside of edit mode it just renders the value
 * as a span; inside edit mode it becomes a button that opens an inline input.
 *
 * Saves on Enter / blur. Cancels on Escape.
 */
export function EditableName({
  value,
  onSave,
  editing,
  className,
  inputClassName,
}: {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  editing: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const [isInput, setIsInput] = useState(false);
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  // If the parent re-issues the value (e.g. after save+refresh) keep state in sync.
  useEffect(() => {
    setText(value);
  }, [value]);

  // Auto-focus when entering input mode.
  useEffect(() => {
    if (isInput) ref.current?.select();
  }, [isInput]);

  function commit() {
    const trimmed = text.trim();
    setIsInput(false);
    if (!trimmed || trimmed === value) {
      setText(value);
      return;
    }
    void onSave(trimmed);
  }

  function cancel() {
    setText(value);
    setIsInput(false);
  }

  if (!editing) {
    return <span className={className}>{value}</span>;
  }
  if (!isInput) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsInput(true);
        }}
        className={`${className ?? ""} text-left rounded px-1 -mx-1 hover:bg-surface-2/60 transition cursor-text`}
        title="Click to rename"
      >
        {value}
        <span className="ml-1 text-xs text-text-muted">✎</span>
      </button>
    );
  }
  return (
    <input
      ref={ref}
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      maxLength={60}
      className={`${inputClassName ?? ""} px-2 py-1 rounded bg-surface border border-primary focus:outline-none focus:ring-2 focus:ring-primary/40`}
    />
  );
}
