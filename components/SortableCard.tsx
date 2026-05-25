"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";

/**
 * Generic wrapper that turns its child into a drag-sortable item when
 * `enabled` is true. While dragging the item gets a `cursor-grabbing`
 * + slightly elevated style; otherwise normal layout.
 *
 * The drag handle covers the entire card surface (so the user can grab
 * anywhere) — interactive controls inside (buttons, inputs, the EditableName
 * input, etc.) stop propagation themselves so they aren't accidentally
 * triggered as a drag start.
 */
export function SortableCard({
  id,
  enabled,
  children,
}: {
  id: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !enabled });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
    cursor: enabled ? (isDragging ? "grabbing" : "grab") : "auto",
    // Lift while dragging.
    boxShadow: isDragging
      ? "0 20px 40px rgba(0,0,0,0.18)"
      : undefined,
    opacity: isDragging ? 0.92 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(enabled ? attributes : {})}
      {...(enabled ? listeners : {})}
    >
      {children}
    </div>
  );
}
