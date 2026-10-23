# GitHub PR Status

Owns GitHub pull request data and actions for bb environments. Bundled and enabled by default.

- `host.ts` batches GraphQL reads through `gh api graphql` and runs `gh pr ready|merge` in the environment's workspace on its machine.
- `server.ts` resolves environments, assembles the status core's PR UI renders, serves the keyed `pullRequests` read and the `markReady`, `markDraft` and `merge` mutations, and registers `bb pull-request`.
- `store.ts` shares snapshots, in-flight reads and pending-check timers by PR URL, and publishes only changed rows.
- `persistence.ts` uses the plugin's own database through `bb.storage.database()` / `migrate()`. It stores current snapshots and environment links, including known absence. There is no history or core database migration. Identical PR content and links do not write rows; a restart serves saved content immediately and refreshes overdue data in the background.
- `contract.ts` is the public contract. Core's composer banner, Info row and sidebar shim read through it with `pluginId: "bb--github-pr-status"`, the way any other plugin would.

Plugin host calls never wake a suspended machine: reads return `unavailable`, and actions fail with a message naming the machine.

The experimental read returns `{ outcome: "available", pullRequests: [...], currentBranchUrl }`, current-branch PR first. Previously discovered branch PRs remain linked and share the same refresh rules. Core and the retired sidebar shim display the first entry when `currentBranchUrl` is non-null; older links on a branch without a PR leave the existing UI empty. No multi-PR UI or additional discovery is included. `bb pull-request show --json` uses the same list. Actions still target the current branch and bypass the discovery cache.

Watched open PRs with pending checks, unknown mergeability, a merge queue entry or auto-merge refresh about every 30 seconds. Quiet and settled PRs do not poll; foreground mount/focus and environment events still refresh them. A new quiet/absent reconciliation timer was excluded because main performs zero background reads in those states. Ref events compare the local upstream OID without fetching. Turns without a PR rediscover; known PRs recheck only after a turn that ran `gh`.

Reads on each workspace host are grouped by GitHub hostname and credential (including gh profile account changes) into documents of at most 25 PRs with a 10 ms collection window. Missing credentials or a sleeping host return unavailable. Rate limits pause the affected credential for at least one minute. No credentials or ETags are persisted; measured ETag revalidation still needed two checks requests, versus one combined GraphQL request.
