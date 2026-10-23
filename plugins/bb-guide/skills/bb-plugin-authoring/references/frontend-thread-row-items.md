# Items on thread rows

`app.slots.experimental_threadRowItem` adds a small item to every thread row in
bb's sidebar, beside the title and before the status glyph. Plugin-built lists
draw the same items with `experimental_ThreadRowItems` (see "bb's row items on
your row"). The GitHub PR Status plugin's pull request badge is one.

```tsx
app.slots.experimental_threadRowItem({ id: "deploy", order: 10, component: DeployBadge });
function DeployBadge({ thread, isLive }: ExperimentalThreadRowItemProps) {
  const key = thread.environment?.id;
  const { data } = experimental_useRpcKeyedQuery({
    contract, method: "deploys", keys: key ? [key] : [], enabled: isLive && key !== undefined,
  });
  const deploy = key ? data?.[key] : undefined;
  return deploy ? <DeployGlyph deploy={deploy} /> : null;
}
```

Components receive `{ thread, isLive }` and mount only while their row is near
the screen; return null to show nothing. `isLive` turns true once the row has
stayed on screen through a short scroll pause with the page visible, and false
again when it leaves or the page hides. Gate reads, watches and polling on it
and render cached data either way: rows that appear together read together in
one keyed request, rows scrolled past read nothing, and cached items draw in
the row's first frame. Keep the item icon-sized with a tooltip; the row's items
share at most 80 px, are hidden while the row is renamed or customized, and a
click on them opens the thread. Items sort by `order` (unset last), then
registration order. A crash removes only that item on that row.

## bb's row items on your row

A plugin-built thread list renders every plugin's `experimental_threadRowItem`
(bb's pull request badge among them) by placing `experimental_ThreadRowItems`
with the row's `thread` inside the row's title area, after the title. It
renders nothing when no plugin contributes an item. Clicks on an item reach
your row's own handlers; forward them to your row link if the row is not
itself the link. frontend-pull-requests.md shows a full row.
