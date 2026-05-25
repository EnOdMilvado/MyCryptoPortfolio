"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  // Portals only work on the client. Track mount so server render returns
  // null and we avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // Lock body scroll while the modal is open so background content
    // doesn't shift behind the dimmer.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const overlay = (
    <div
      // Backdrop: darker overlay + stronger blur so the page content behind
      // the modal is clearly separated.
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        // Solid surface (no opacity) so the dialog reads as a single panel,
        // not a translucent overlay on top of the page.
        className="bg-surface border border-border rounded-xl2 shadow-soft p-4 sm:p-6 max-h-[90vh] overflow-y-auto max-w-md w-full animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-muted hover:text-text text-2xl leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );

  // Render directly into <body> so the modal escapes any ancestor that
  // sets `transform`, `filter`, `backdrop-filter`, `perspective`, or
  // `will-change` — all of which would otherwise turn that ancestor into
  // the containing block for `position: fixed`, trapping the modal inside
  // a card / header / table cell.
  return createPortal(overlay, document.body);
}
