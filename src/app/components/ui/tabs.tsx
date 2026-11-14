'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './utils';

export interface TabItem {
  id: string;
  label: string;
  /** Element ids inside the tab, so old #anchor links still land on the right tab. */
  anchors?: readonly string[];
  /** A short count or marker shown after the label. */
  badge?: ReactNode;
  content: ReactNode;
}

/**
 * Page tabs kept in the ?tab= parameter. Every panel stays mounted, so
 * unsaved edits survive switching, and switching never reloads the page.
 */
export function Tabs({
  items,
  label,
  param = 'tab',
  panelClassName,
}: {
  items: readonly TabItem[];
  label: string;
  param?: string;
  panelClassName?: string;
}) {
  const searchParams = useSearchParams();
  const listRef = useRef<HTMLDivElement | null>(null);
  const first = items[0]?.id ?? '';
  const requested = searchParams.get(param);
  const active = items.some((item) => item.id === requested) ? (requested ?? first) : first;

  function select(id: string, focus = false) {
    const params = new URLSearchParams(window.location.search);
    if (id === first) params.delete(param);
    else params.set(param, id);
    const query = params.toString();
    // Next keeps useSearchParams in sync with history calls, without a server round trip.
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    if (focus) listRef.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus();
  }

  // Links written before the tabs used #section anchors; honour them once.
  const pendingAnchor = useRef<string | null>(null);
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash) return;
    const match = items.find((item) => item.id === hash || item.anchors?.includes(hash));
    if (!match) return;
    if (hash !== match.id) pendingAnchor.current = hash;
    select(match.id);
    // Runs once on arrival; later hash changes come from in-page links we no longer write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The section can only be scrolled to once its tab is showing.
  useEffect(() => {
    const anchor = pendingAnchor.current;
    if (!anchor) return;
    const element = document.getElementById(anchor);
    if (!element || element.closest('[hidden]')) return;
    pendingAnchor.current = null;
    element.scrollIntoView({ block: 'start' });
  }, [active]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = items.findIndex((item) => item.id === active);
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = items[(target + items.length) % items.length];
    if (next) select(next.id, true);
  }

  return (
    <>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        className="no-scrollbar flex shrink-0 gap-6 overflow-x-auto border-b border-border px-6"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              data-tab={item.id}
              aria-selected={selected}
              aria-controls={`panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                select(item.id);
              }}
              onKeyDown={onKeyDown}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-transparent py-3 text-sm text-muted-foreground transition-colors hover:text-foreground',
                selected && 'border-foreground font-medium text-foreground',
              )}
            >
              {item.label}
              {item.badge}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`panel-${item.id}`}
          aria-labelledby={`tab-${item.id}`}
          hidden={item.id !== active}
          className={panelClassName}
        >
          {item.content}
        </div>
      ))}
    </>
  );
}
