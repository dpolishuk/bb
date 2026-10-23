import { z } from "zod";
import { gitBranchNameSchema } from "./git-checkout.js";

export const gitObjectIdSchema = z.string().regex(/^[0-9a-f]{4,40}$/iu);

export const diffViewedFileSchema = z
  .object({ path: z.string().min(1), revision: z.string().min(1) })
  .strict();
export type DiffViewedFile = z.infer<typeof diffViewedFileSchema>;

export const workspaceDiffTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommitted") }).strict(),
  z
    .object({
      type: z.literal("branch_committed"),
      mergeBaseBranch: gitBranchNameSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("all"), mergeBaseBranch: gitBranchNameSchema })
    .strict(),
  z.object({ type: z.literal("commit"), sha: gitObjectIdSchema }).strict(),
]);
export type WorkspaceDiffTarget = z.infer<typeof workspaceDiffTargetSchema>;

export const rawDiffFileStatSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  statusLetter: z.enum(["A", "M", "D", "R", "C", "T"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  origin: z.enum(["tracked", "untracked"]),
  revision: z.string().min(1),
});
export type RawDiffFileStat = z.infer<typeof rawDiffFileStatSchema>;

export const threadGitDiffResponseSchema = z.object({
  diff: z.string(),
  truncated: z.boolean(),
  shortstat: z.string(),
  files: z.string(),
  mergeBaseRef: z.string().nullable(),
});
export type ThreadGitDiffResponse = z.infer<typeof threadGitDiffResponseSchema>;

export const gitDiffFileChangeKindSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type_changed",
]);
export type GitDiffFileChangeKind = z.infer<typeof gitDiffFileChangeKindSchema>;
