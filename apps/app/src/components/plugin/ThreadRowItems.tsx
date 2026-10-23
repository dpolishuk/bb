import { memo, useRef } from "react";
import type {
  ExperimentalThreadRowItemsProps,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { compareGroupedPlacement } from "@/lib/grouped-placement";
import {
  usePluginSlots,
  type PluginThreadRowItemSlot,
} from "@/lib/plugin-slots";
import { useThreadRowVisibility } from "@/lib/thread-row-visibility";

function sortThreadRowItems(
  slots: readonly PluginThreadRowItemSlot[],
): PluginThreadRowItemSlot[] {
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((left, right) =>
      compareGroupedPlacement(
        { group: "", order: left.slot.order },
        left.index,
        { group: "", order: right.slot.order },
        right.index,
      ),
    )
    .map(({ slot }) => slot);
}

function MountedThreadRowItems({
  thread,
  slots,
}: {
  thread: PluginSidebarThread;
  slots: readonly PluginThreadRowItemSlot[];
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const visibility = useThreadRowVisibility(anchor);
  const isLive = visibility === "live";
  return (
    <span
      ref={anchor}
      data-thread-row-items=""
      className="pointer-events-auto relative z-[31] ml-auto hidden max-w-20 shrink-0 items-center gap-1 overflow-hidden has-[[data-bb-plugin-root]:not(:empty)]:flex"
    >
      {visibility === "offscreen"
        ? null
        : slots.map((slot) => {
            const Component = slot.component;
            return (
              <PluginSlotMount
                key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
                pluginId={slot.pluginId}
                slotKind="threadRowItem"
                slotId={slot.id}
                instanceId={thread.id}
                crashFallback={null}
              >
                <Component thread={thread} isLive={isLive} />
              </PluginSlotMount>
            );
          })}
    </span>
  );
}

export const ThreadRowItems = memo(function ThreadRowItems({
  thread,
}: ExperimentalThreadRowItemsProps) {
  const { threadRowItems } = usePluginSlots();
  if (threadRowItems.length === 0) return null;
  return (
    <MountedThreadRowItems
      thread={thread}
      slots={sortThreadRowItems(threadRowItems)}
    />
  );
});
