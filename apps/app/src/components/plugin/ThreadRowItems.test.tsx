// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadRowItemProps } from "@get-bb/plugin-sdk";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { toPluginSidebarThread } from "@/lib/plugin-sidebar-threads";
import { THREAD_ROW_SETTLE_MS } from "@/lib/thread-row-visibility";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { ThreadRowItems } from "./ThreadRowItems";

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  fire(target: Element, isIntersecting: boolean) {
    if (!this.targets.has(target)) return;
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function intersect(target: Element, isIntersecting: boolean) {
  act(() => {
    for (const observer of FakeIntersectionObserver.instances)
      observer.fire(target, isIntersecting);
  });
}

const thread = toPluginSidebarThread(makeThreadListEntry({ id: "thr_row" }));
const seen: { id: string; isLive: boolean }[] = [];

function item(label: string) {
  return function Item({ thread, isLive }: ExperimentalThreadRowItemProps) {
    seen.push({ id: label, isLive });
    return (
      <span data-testid={label} data-live={isLive ? "" : undefined}>
        {thread.id}
      </span>
    );
  };
}

function Crashes(): never {
  throw new Error("row item crashed");
}

function renderRow() {
  const view = render(
    <div data-testid="row">
      <ThreadRowItems thread={thread} />
    </div>,
  );
  return { ...view, row: screen.getByTestId("row") };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("demo");
  resetAllCrashedPluginSlotsForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
  seen.length = 0;
});

describe("thread row items", () => {
  it("draws items in the row's first frame and turns them live only after a scroll pause on screen", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowItems: [{ id: "badge", component: item("badge") }],
      }),
    );
    const { row } = renderRow();
    expect(screen.getByTestId("badge").dataset.live).toBeUndefined();

    intersect(row, true);
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS - 1));
    expect(screen.getByTestId("badge").dataset.live).toBeUndefined();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("badge").dataset.live).toBe("");

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByTestId("badge").dataset.live).toBeUndefined();
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS);
    });
    expect(screen.getByTestId("badge").dataset.live).toBe("");

    intersect(row, false);
    expect(screen.getByTestId("badge").dataset.live).toBe("");
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS));
    expect(screen.getByTestId("badge").dataset.live).toBeUndefined();
  });

  it("keeps rows that scroll past from going live and re-renders nothing while scrolling", () => {
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowItems: [{ id: "badge", component: item("badge") }],
      }),
    );
    const { row } = renderRow();
    const rendersAtMount = seen.length;
    intersect(row, true);
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS / 2));
    intersect(row, false);
    act(() => vi.advanceTimersByTime(THREAD_ROW_SETTLE_MS * 5));
    expect(seen.some((render) => render.isLive)).toBe(false);
    expect(seen).toHaveLength(rendersAtMount);
  });

  it("orders items, renders nothing without contributions, and drops only a crashing item", () => {
    const empty = renderRow();
    expect(empty.row.querySelector("[data-thread-row-items]")).toBeNull();
    empty.unmount();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "demo",
      makePluginRegistrationSet({
        threadRowItems: [
          { id: "unordered", component: item("unordered") },
          { id: "crash", order: 1, component: Crashes },
          { id: "second", order: 2, component: item("second") },
          { id: "first", order: 0, component: item("first") },
        ],
      }),
    );
    const { row } = renderRow();
    expect(
      [...row.querySelectorAll("[data-testid]")].map((element) =>
        element.getAttribute("data-testid"),
      ),
    ).toEqual(["first", "second", "unordered"]);
  });
});
