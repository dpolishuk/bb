import type {
  EnvironmentPullRequest,
  EnvironmentPullRequests,
  PullRequest,
} from "./contract.js";
import type { PullRequestPersistence } from "./persistence.js";

const CACHE_TTL_MS = 10_000;
const ACTIVE_CHECK_MS = 30_000;

type Snapshot = {
  pullRequest: PullRequest;
  fetchedAt: number;
  lastChangedAt: number;
};
type Lookup = { result: EnvironmentPullRequest; fetchedAt: number };

function active(pr: PullRequest): boolean {
  return (
    pr.state === "open" &&
    (pr.autoMerge ||
      pr.inMergeQueue === true ||
      pr.checks.state === "pending" ||
      pr.mergeability.state === "unknown")
  );
}

export function createPullRequestStore(options: {
  load(
    environmentId: string,
    url: string | null,
    refresh: boolean,
  ): Promise<EnvironmentPullRequest>;
  branch(environmentId: string): string | null;
  persistence: PullRequestPersistence;
  publish(environmentIds: readonly string[]): void;
  onCheckFailed(environmentId: string, error: unknown): void;
}) {
  const snapshots = new Map<string, Snapshot>();
  const lookups = new Map<string, Lookup>();
  const links = new Map<string, Set<string>>();
  const watches = new Map<string, Set<AbortSignal>>();
  const served = new Map<string, string>();
  const inflight = new Map<string, Promise<void>>();
  const loadingReaders = new Map<string, Set<string>>();
  const settling = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const generations = new Map<string, number>();
  const restored = new Set<string>();
  let disposed = false;
  for (const snapshot of options.persistence.snapshots())
    snapshots.set(snapshot.pullRequest.url, snapshot);
  for (const link of options.persistence.links()) {
    if (link.url !== null) {
      const urls = links.get(link.environmentId) ?? new Set<string>();
      urls.add(link.url);
      links.set(link.environmentId, urls);
    }
    if (!link.current) continue;
    const snapshot = link.url === null ? undefined : snapshots.get(link.url);
    lookups.set(link.environmentId, {
      result: snapshot
        ? { outcome: "available", pullRequest: snapshot.pullRequest }
        : { outcome: "absent" },
      fetchedAt: snapshot?.fetchedAt ?? link.discoveredAt,
    });
    restored.add(link.environmentId);
  }

  function currentUrl(environmentId: string): string | null {
    const result = lookups.get(environmentId)?.result;
    return result?.outcome === "available" ? result.pullRequest.url : null;
  }

  function resultFor(environmentId: string): EnvironmentPullRequests {
    const current = lookups.get(environmentId)?.result;
    if (current?.outcome === "unavailable") return current;
    const urls = new Set<string>();
    const url = currentUrl(environmentId);
    if (url !== null) urls.add(url);
    for (const linked of links.get(environmentId) ?? []) urls.add(linked);
    const pullRequests = [...urls].flatMap((linked) => {
      const snapshot = snapshots.get(linked);
      return snapshot ? [snapshot.pullRequest] : [];
    });
    return pullRequests.length > 0
      ? { outcome: "available", pullRequests, currentBranchUrl: url }
      : { outcome: "absent" };
  }

  function publishChanges(readers: ReadonlySet<string>) {
    if (disposed) return;
    const changed: string[] = [];
    for (const environmentId of watches.keys()) {
      const content = JSON.stringify(resultFor(environmentId));
      const previous = served.get(environmentId);
      if (
        previous !== undefined &&
        previous !== content &&
        !readers.has(environmentId)
      )
        changed.push(environmentId);
      served.set(environmentId, content);
    }
    if (changed.length > 0) options.publish(changed);
  }

  function watchedEnvironment(url: string): string | undefined {
    for (const environmentId of watches.keys()) {
      if (links.get(environmentId)?.has(url)) return environmentId;
    }
    return undefined;
  }

  function schedule() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    if (disposed) return;
    for (const [url, snapshot] of snapshots) {
      const environmentId = watchedEnvironment(url);
      if (
        environmentId === undefined ||
        (!active(snapshot.pullRequest) &&
          (settling.get(url) ?? 0) <= snapshot.fetchedAt) ||
        inflight.has(url)
      )
        continue;
      const delay = Math.max(
        0,
        snapshot.fetchedAt + ACTIVE_CHECK_MS - Date.now(),
      );
      timers.set(
        url,
        setTimeout(() => {
          timers.delete(url);
          void load(environmentId, url, new Set());
        }, delay),
      );
    }
  }

  async function load(
    environmentId: string,
    url: string | null,
    readers: ReadonlySet<string>,
    refresh = false,
  ): Promise<void> {
    const key = url ?? `environment:${environmentId}`;
    const pending = inflight.get(key);
    if (pending !== undefined) {
      for (const reader of readers) loadingReaders.get(key)?.add(reader);
      return pending;
    }
    const recipients = new Set(readers);
    loadingReaders.set(key, recipients);
    const generation = generations.get(environmentId) ?? 0;
    const task = Promise.resolve()
      .then(async () => {
        let result = await options.load(environmentId, url, refresh);
        if (url !== null && result.outcome === "unavailable") {
          for (const candidate of watches.keys()) {
            if (candidate === environmentId || !links.get(candidate)?.has(url))
              continue;
            const alternative = await options.load(candidate, url, false);
            if (
              alternative.outcome === "available" &&
              alternative.pullRequest.url === url
            ) {
              result = alternative;
              break;
            }
          }
        }
        if (disposed || (generations.get(environmentId) ?? 0) !== generation)
          return;
        const fetchedAt = Date.now();
        if (result.outcome === "available") {
          const pr = result.pullRequest;
          const previous = snapshots.get(pr.url);
          const changed =
            JSON.stringify(previous?.pullRequest) !== JSON.stringify(pr);
          const snapshot = {
            pullRequest: pr,
            fetchedAt,
            lastChangedAt: changed ? fetchedAt : previous!.lastChangedAt,
          };
          snapshots.set(pr.url, snapshot);
          options.persistence.saveSnapshot(
            pr,
            fetchedAt,
            snapshot.lastChangedAt,
          );
          const urls = links.get(environmentId) ?? new Set<string>();
          urls.add(pr.url);
          links.set(environmentId, urls);
          for (const [id, lookup] of lookups) {
            if (
              lookup.result.outcome === "available" &&
              lookup.result.pullRequest.url === pr.url
            )
              lookups.set(id, { result, fetchedAt });
          }
        } else if (url !== null) {
          const snapshot = snapshots.get(url);
          if (snapshot !== undefined) snapshot.fetchedAt = fetchedAt;
        }
        if (url === null || currentUrl(environmentId) === url) {
          lookups.set(environmentId, { result, fetchedAt });
          if (result.outcome !== "unavailable")
            options.persistence.link(
              environmentId,
              result.outcome === "available" ? result.pullRequest.url : null,
              options.branch(environmentId),
              fetchedAt,
            );
        }
        publishChanges(recipients);
      })
      .catch((error) => {
        if (url !== null) {
          const snapshot = snapshots.get(url);
          if (snapshot) snapshot.fetchedAt = Date.now();
        }
        options.onCheckFailed(environmentId, error);
      })
      .finally(() => {
        if (inflight.get(key) === task) {
          inflight.delete(key);
          loadingReaders.delete(key);
        }
        schedule();
      });
    inflight.set(key, task);
    return task;
  }

  async function read(
    environmentId: string,
    { viewer }: { viewer: boolean },
  ): Promise<EnvironmentPullRequests> {
    const cached = lookups.get(environmentId);
    const immediate = restored.has(environmentId) && cached !== undefined;
    if (viewer) restored.delete(environmentId);
    const readers = new Set(viewer && !immediate ? [environmentId] : []);
    const loads: Promise<void>[] = [];
    if (cached === undefined || Date.now() - cached.fetchedAt >= CACHE_TTL_MS)
      loads.push(load(environmentId, currentUrl(environmentId), readers));
    for (const url of links.get(environmentId) ?? []) {
      if (url === currentUrl(environmentId)) continue;
      const snapshot = snapshots.get(url);
      if (
        snapshot !== undefined &&
        Date.now() - snapshot.fetchedAt >= CACHE_TTL_MS
      )
        loads.push(load(environmentId, url, readers));
    }
    if (immediate) void Promise.all(loads);
    else await Promise.all(loads);
    const result = resultFor(environmentId);
    if (viewer) served.set(environmentId, JSON.stringify(result));
    schedule();
    return result;
  }

  return {
    read,
    currentUrl,
    hasPullRequest(environmentId: string) {
      return currentUrl(environmentId) !== null;
    },
    isWatched(environmentId: string) {
      return watches.has(environmentId);
    },
    refresh(environmentId: string, discover = false) {
      if (discover) {
        generations.set(
          environmentId,
          (generations.get(environmentId) ?? 0) + 1,
        );
        lookups.delete(environmentId);
        restored.delete(environmentId);
      } else {
        const cached = lookups.get(environmentId);
        if (cached) cached.fetchedAt = Number.NEGATIVE_INFINITY;
      }
      if (watches.has(environmentId)) {
        const url = discover ? null : currentUrl(environmentId);
        const pending = inflight.get(url ?? `environment:${environmentId}`);
        if (pending)
          void pending.then(() =>
            load(environmentId, url, new Set(), discover),
          );
        else void load(environmentId, url, new Set(), discover);
      }
    },
    pushed(environmentId: string) {
      const url = currentUrl(environmentId);
      if (url === null) return;
      settling.set(url, Date.now() + ACTIVE_CHECK_MS);
      const cached = lookups.get(environmentId);
      if (cached) cached.fetchedAt = Number.NEGATIVE_INFINITY;
      if (watches.has(environmentId)) void load(environmentId, url, new Set());
    },
    recheck(environmentId: string) {
      if (watches.has(environmentId))
        void read(environmentId, { viewer: false });
    },
    remove(environmentId: string) {
      const previous = JSON.stringify(resultFor(environmentId));
      generations.set(environmentId, (generations.get(environmentId) ?? 0) + 1);
      lookups.delete(environmentId);
      links.delete(environmentId);
      restored.delete(environmentId);
      served.delete(environmentId);
      options.persistence.removeEnvironment(environmentId);
      if (
        watches.has(environmentId) &&
        previous !== JSON.stringify(resultFor(environmentId))
      )
        options.publish([environmentId]);
      for (const url of snapshots.keys()) {
        if (![...links.values()].some((urls) => urls.has(url))) {
          snapshots.delete(url);
          settling.delete(url);
        }
      }
      schedule();
    },
    watch(environmentId: string, signal: AbortSignal) {
      if (signal.aborted || disposed) return;
      const signals = watches.get(environmentId) ?? new Set<AbortSignal>();
      signals.add(signal);
      watches.set(environmentId, signals);
      signal.addEventListener(
        "abort",
        () => {
          signals.delete(signal);
          if (signals.size === 0) watches.delete(environmentId);
          schedule();
        },
        { once: true },
      );
      void read(environmentId, { viewer: false });
    },
    dispose() {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
