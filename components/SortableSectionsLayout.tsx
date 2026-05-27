"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";

export interface PageSection {
  id: string;
  /** Short human label used in the "Layout" mode handle. */
  label?: string;
  node: ReactNode;
}

/**
 * Vertical drag-to-reorder layout for top-level page sections. Renders an
 * Edit button (when editable) that flips a `wiggle` mode where each
 * section wears a drag handle + slight wobble; user drags sections up or
 * down to change order. Order persisted in localStorage under
 * `storageKey`.
 */
export function SortableSectionsLayout({
  sections,
  storageKey,
}: {
  /** All renderable sections this page wants in user-orderable order. */
  sections: PageSection[];
  /** localStorage key used to remember the user's order. */
  storageKey: string;
}) {
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);

  // Hydrate from localStorage once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) {
          setOrder(arr);
          return;
        }
      }
    } catch {}
    setOrder(sections.map((s) => s.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Whenever the server-provided sections list changes (new section added,
  // one removed) reconcile order: keep stored order for known ids, then
  // append any newcomers at the end.
  useEffect(() => {
    if (!order) return;
    const incoming = sections.map((s) => s.id);
    const known = new Set(order);
    const filtered = order.filter((id) => incoming.includes(id));
    const newcomers = incoming.filter((id) => !known.has(id));
    if (filtered.length === order.length && newcomers.length === 0) return;
    setOrder([...filtered, ...newcomers]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  function persist(next: string[]) {
    setOrder(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || !order || active.id === over.id) return;
    const oldIdx = order.indexOf(String(active.id));
    const newIdx = order.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = [...order];
    const [moved] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, moved);
    persist(next);
  }

  // Build the rendered list in user-order. Unknown ids are appended at the
  // end so newly-added sections don't disappear silently.
  const ordered = useMemo<PageSection[]>(() => {
    if (!order) return sections;
    const byId = new Map(sections.map((s) => [s.id, s]));
    const out: PageSection[] = [];
    for (const id of order) {
      const s = byId.get(id);
      if (s) out.push(s);
    }
    for (const s of sections) {
      if (!order.includes(s.id)) out.push(s);
    }
    return out;
  }, [sections, order]);

  const ids = ordered.map((s) => s.id);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-end -mb-4">
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className={`text-xs font-semibold inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition ${
            editing
              ? "bg-primary text-white shadow-sm"
              : "bg-surface-2 text-text-muted hover:text-text"
          }`}
          title={editing ? "Done editing layout" : "Edit page layout"}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          {editing ? "Done" : "Edit layout"}
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="space-y-8">
            {ordered.map((s) => (
              <SortableSection key={s.id} id={s.id} editing={editing} label={s.label}>
                {s.node}
              </SortableSection>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableSection({
  id,
  editing,
  label,
  children,
}: {
  id: string;
  editing: boolean;
  label?: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !editing });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
    boxShadow: isDragging ? "0 20px 40px rgba(0,0,0,0.18)" : undefined,
    opacity: isDragging ? 0.92 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${editing ? "ring-1 ring-primary/20 rounded-2xl" : ""}`}
    >
      {editing && (
        <div
          {...attributes}
          {...listeners}
          className="absolute -left-3 top-2 z-20 inline-flex items-center gap-1.5 rounded-md bg-primary text-white px-2 py-1.5 text-[11px] font-semibold cursor-grab active:cursor-grabbing shadow-sm select-none hover:bg-primary-hover"
          title="Drag to reorder"
        >
          {/* Three horizontal lines (hamburger / grip) icon */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
          {label && <span>{label}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
