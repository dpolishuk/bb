import { useQuery } from "@tanstack/react-query";
import type { InstalledPlugin } from "@bb/server-contract";
import { pluginListQueryOptions } from "./plugin-settings-queries";
import { useEffect, useRef } from "react";
import {
  GITHUB_PR_STATUS_PLUGIN_ID,
  githubPrStatusRpcContract,
  isEnvironmentPullRequestStale,
  type PullRequest,
} from "bb-plugin-bb--github-pr-status/contract";
import {
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@/lib/plugin-sdk-hooks";

const loadedAtByEnvironment = new Map<string, number>();

function refetchEnvironment(
  environmentId: string,
  refetch: () => Promise<void>,
): void {
  void refetch().then(() => {
    loadedAtByEnvironment.set(environmentId, Date.now());
  });
}

export interface EnvironmentPullRequestState {
  isLoading: boolean;
  pullRequest: PullRequest | null;
}

function selectPrStatusEnabled(plugins: InstalledPlugin[]): boolean {
  return plugins.some(
    (plugin) => plugin.id === GITHUB_PR_STATUS_PLUGIN_ID && plugin.enabled,
  );
}

export function useEnvironmentPullRequest(
  environmentId: string | null | undefined,
  options: { enabled?: boolean } = {},
): EnvironmentPullRequestState {
  const requested = (options.enabled ?? true) && Boolean(environmentId);
  const plugin = useQuery({
    ...pluginListQueryOptions({ enabled: requested }),
    select: selectPrStatusEnabled,
  });
  const enabled = requested && plugin.data !== false;
  const query = useRpcKeyedQuery({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusRpcContract,
    method: "pullRequests",
    keys: enabled && environmentId ? [environmentId] : [],
    enabled,
  });
  const row = environmentId ? query.data?.[environmentId] : undefined;
  const { refetch } = query;
  const latest = useRef({ row, refetch });
  useEffect(() => {
    latest.current = { row, refetch };
  });

  useEffect(() => {
    if (environmentId && row !== undefined)
      loadedAtByEnvironment.set(environmentId, Date.now());
  }, [environmentId, row]);

  useEffect(() => {
    if (!enabled || !environmentId) return;
    if (latest.current.row !== undefined)
      refetchEnvironment(environmentId, latest.current.refetch);
    const refetchIfStale = () => {
      if (document.visibilityState === "hidden") return;
      const current = latest.current.row;
      if (
        current !== undefined &&
        isEnvironmentPullRequestStale(
          current,
          loadedAtByEnvironment.get(environmentId) ?? 0,
          Date.now(),
        )
      ) {
        refetchEnvironment(environmentId, latest.current.refetch);
      }
    };
    document.addEventListener("visibilitychange", refetchIfStale);
    window.addEventListener("pageshow", refetchIfStale);
    return () => {
      document.removeEventListener("visibilitychange", refetchIfStale);
      window.removeEventListener("pageshow", refetchIfStale);
    };
  }, [enabled, environmentId]);

  return {
    isLoading: enabled && query.error === null && row === undefined,
    pullRequest:
      enabled && row?.outcome === "available" ? row.pullRequest : null,
  };
}

export function usePullRequestActions() {
  const markReady = useRpcMutation({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusRpcContract,
    method: "markReady",
  });
  const markDraft = useRpcMutation({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusRpcContract,
    method: "markDraft",
  });
  const merge = useRpcMutation({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID,
    contract: githubPrStatusRpcContract,
    method: "merge",
  });
  return {
    isPending: markReady.isPending || markDraft.isPending || merge.isPending,
    markReady: markReady.mutate,
    markDraft: markDraft.mutate,
    merge: merge.mutate,
  };
}
