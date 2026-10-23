import {
  GIT_PLUGIN_ID,
  type ThreadGitDiffResponse,
  type WorkspaceResolutionFailure,
  type WorkspaceStatus,
} from "bb-git-contract";
import {
  gitDiffResultSchema,
  gitStatusResultSchema,
} from "bb-plugin-bb--git/contract";
import { ApiError } from "../../errors.js";
import type { PluginService } from "../plugins/plugin-service.js";

export type GitPluginRpc = Pick<
  PluginService,
  "getRpcHandler" | "invokeRpcHandler"
>;

type UnavailableLookup = Exclude<
  ReturnType<GitPluginRpc["getRpcHandler"]>,
  { outcome: "found" }
>;

function pluginState(lookup: UnavailableLookup): string | null {
  if (lookup.outcome !== "not-running") {
    return lookup.outcome === "unknown-plugin" ? null : "loaded without its reads";
  }
  switch (lookup.status) {
    case "disabled":
      return null;
    case "starting":
      return "still starting";
    case "error":
      return "failing to load";
    case "incompatible":
      return "incompatible with this bb";
    case "missing":
      return "missing its files";
    case "degraded":
      return "degraded";
    case "needs-configuration":
      return "waiting for configuration";
    case "running":
      return "loaded without its reads";
  }
}

function unavailableMessage(lookup: UnavailableLookup): string {
  const state = pluginState(lookup);
  if (state === null) {
    return "Turn on the Git plugin to read this environment's changes";
  }
  const detail =
    lookup.outcome === "not-running" && lookup.detail !== null
      ? ` (${lookup.detail})`
      : "";
  return `The Git plugin is ${state}${detail}. Reload it in Settings → Plugins to read this environment's changes`;
}

async function callGitPlugin(
  plugins: GitPluginRpc,
  method: string,
  input: unknown,
): Promise<unknown> {
  const lookup = plugins.getRpcHandler(GIT_PLUGIN_ID, method);
  if (lookup.outcome !== "found") {
    throw new ApiError(409, "git_plugin_unavailable", unavailableMessage(lookup));
  }
  const outcome = await plugins.invokeRpcHandler(
    GIT_PLUGIN_ID,
    method,
    lookup.value,
    input,
    { kind: "client" },
  );
  if (!outcome.ok) {
    throw new ApiError(
      outcome.error.code === "conflict" ? 409 : 502,
      outcome.error.code === "conflict"
        ? "environment_not_ready"
        : "git_plugin_failed",
      outcome.error.message,
    );
  }
  return outcome.result;
}

function throwWorkspaceUnavailable(failure: WorkspaceResolutionFailure): never {
  throw new ApiError(409, "workspace_unavailable", failure.message, {
    details: { kind: "workspace_unavailable", failure },
  });
}

function throwUnavailableRead(
  result:
    | { outcome: "not_applicable"; message: string }
    | { outcome: "unavailable"; failure: WorkspaceResolutionFailure },
  workspacePath: string,
): never {
  if (result.outcome === "unavailable") throwWorkspaceUnavailable(result.failure);
  throwWorkspaceUnavailable({
    code: "not_git_repo",
    message: result.message,
    workspacePath,
  });
}

export async function refreshGitState(
  plugins: GitPluginRpc,
  environmentId: string,
): Promise<void> {
  const lookup = plugins.getRpcHandler(GIT_PLUGIN_ID, "refresh");
  if (lookup.outcome !== "found") return;
  await plugins.invokeRpcHandler(
    GIT_PLUGIN_ID,
    "refresh",
    lookup.value,
    { environmentId },
    { kind: "client" },
  );
}

export async function readCommitInputs(
  plugins: GitPluginRpc,
  args: {
    environmentId: string;
    workspacePath: string;
    maxDiffBytes: number;
    maxFileListBytes: number;
  },
): Promise<{ status: WorkspaceStatus; diff: ThreadGitDiffResponse }> {
  const [status, diff] = await Promise.all([
    callGitPlugin(plugins, "workspaceStatus", {
      environmentId: args.environmentId,
    }).then((raw) => gitStatusResultSchema.parse(raw)),
    callGitPlugin(plugins, "diff", {
      environmentId: args.environmentId,
      target: { type: "uncommitted" },
      maxDiffBytes: args.maxDiffBytes,
      maxFileListBytes: args.maxFileListBytes,
    }).then((raw) => gitDiffResultSchema.parse(raw)),
  ]);
  if (status.outcome !== "available") {
    throwUnavailableRead(status, args.workspacePath);
  }
  if (diff.outcome !== "available") {
    throwUnavailableRead(diff, args.workspacePath);
  }
  return { status: status.workspace, diff: diff.diff };
}
