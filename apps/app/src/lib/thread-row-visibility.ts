import { useCallback, useRef, useSyncExternalStore, type RefObject } from "react";

export type ThreadRowVisibility = "offscreen" | "near" | "onscreen" | "live";

export const THREAD_ROW_SETTLE_MS = 200;
const NEAR_MARGIN = "240px 0px";

interface RowState {
  near: boolean;
  onScreen: boolean;
  live: boolean;
  nearObserver: IntersectionObserver;
  listeners: Set<() => void>;
}

const rows = new Map<Element, RowState>();
const nearObservers = new Map<Element | null, IntersectionObserver>();
let screenObserver: IntersectionObserver | null = null;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function visibilityOf(state: RowState): ThreadRowVisibility {
  if (!state.near && !state.onScreen) return "offscreen";
  if (state.live) return "live";
  return state.onScreen ? "onscreen" : "near";
}

function update(state: RowState, change: () => void): void {
  const before = visibilityOf(state);
  change();
  if (visibilityOf(state) === before) return;
  for (const listener of state.listeners) listener();
}

function pageHidden(): boolean {
  return document.visibilityState === "hidden";
}

function settle(): void {
  settleTimer = undefined;
  if (pageHidden()) return;
  for (const state of rows.values())
    if (state.onScreen && !state.live)
      update(state, () => {
        state.live = true;
      });
}

function scheduleSettle(): void {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, THREAD_ROW_SETTLE_MS);
}

function onVisibilityChange(): void {
  if (!pageHidden()) {
    scheduleSettle();
    return;
  }
  clearTimeout(settleTimer);
  settleTimer = undefined;
  for (const state of rows.values())
    update(state, () => {
      state.live = false;
    });
}

function onScreenEntries(entries: readonly IntersectionObserverEntry[]) {
  let entered = false;
  for (const entry of entries) {
    const state = rows.get(entry.target);
    if (state === undefined || state.onScreen === entry.isIntersecting)
      continue;
    entered ||= entry.isIntersecting;
    update(state, () => {
      state.onScreen = entry.isIntersecting;
      if (!entry.isIntersecting) state.live = false;
    });
  }
  if (entered) scheduleSettle();
}

function onNearEntries(entries: readonly IntersectionObserverEntry[]) {
  for (const entry of entries) {
    const state = rows.get(entry.target);
    if (state === undefined || state.near === entry.isIntersecting) continue;
    update(state, () => {
      state.near = entry.isIntersecting;
    });
  }
}

function scrollRoot(element: Element): Element | null {
  for (
    let candidate = element.parentElement;
    candidate !== null;
    candidate = candidate.parentElement
  ) {
    const { overflowY } = getComputedStyle(candidate);
    if (overflowY === "auto" || overflowY === "scroll") return candidate;
  }
  return null;
}

function nearObserverFor(root: Element | null): IntersectionObserver {
  let observer = nearObservers.get(root);
  if (observer === undefined) {
    observer = new IntersectionObserver(onNearEntries, {
      root,
      rootMargin: NEAR_MARGIN,
    });
    nearObservers.set(root, observer);
  }
  return observer;
}

function observeRow(element: Element, listener: () => void): () => void {
  let state = rows.get(element);
  if (state === undefined) {
    if (screenObserver === null) {
      screenObserver = new IntersectionObserver(onScreenEntries);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    const nearObserver = nearObserverFor(scrollRoot(element));
    state = {
      near: true,
      onScreen: false,
      live: false,
      nearObserver,
      listeners: new Set(),
    };
    rows.set(element, state);
    nearObserver.observe(element);
    screenObserver.observe(element);
  }
  state.listeners.add(listener);
  const current = state;
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    rows.delete(element);
    current.nearObserver.unobserve(element);
    screenObserver?.unobserve(element);
    if (rows.size > 0) return;
    for (const observer of nearObservers.values()) observer.disconnect();
    nearObservers.clear();
    screenObserver?.disconnect();
    screenObserver = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    clearTimeout(settleTimer);
    settleTimer = undefined;
  };
}

function boxedAncestor(element: Element): Element | null {
  let candidate = element.parentElement;
  while (
    candidate !== null &&
    getComputedStyle(candidate).display === "contents"
  )
    candidate = candidate.parentElement;
  return candidate;
}

export function useThreadRowVisibility(
  anchor: RefObject<Element | null>,
): ThreadRowVisibility {
  const target = useRef<Element | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (typeof IntersectionObserver === "undefined") return () => {};
      const element = anchor.current && boxedAncestor(anchor.current);
      target.current = element;
      if (!element) return () => {};
      const stop = observeRow(element, listener);
      return () => {
        stop();
        target.current = null;
      };
    },
    [anchor],
  );
  const getSnapshot = useCallback((): ThreadRowVisibility => {
    if (typeof IntersectionObserver === "undefined") return "live";
    const state = target.current && rows.get(target.current);
    return state ? visibilityOf(state) : "near";
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
