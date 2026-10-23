import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { pullRequestSchema, type PullRequest } from "./contract.js";

const snapshotRow = z.object({
  url: z.string().url(),
  content: z.string(),
  fetched_at: z.number(),
  last_changed_at: z.number(),
});
const linkRow = z.object({
  environment_id: z.string(),
  url: z.string().url().nullable(),
  branch: z.string().nullable(),
  discovered_at: z.number(),
  current: z.number().transform((value) => value === 1),
});

export function createPullRequestPersistence(storage: BbPluginApi["storage"]) {
  const db = storage.database();
  storage.migrate(db, [
    `CREATE TABLE snapshots (
      url TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      last_changed_at INTEGER NOT NULL
    );
    CREATE TABLE links (
      environment_id TEXT NOT NULL,
      url TEXT,
      source TEXT NOT NULL CHECK (source = 'current-branch'),
      branch TEXT,
      discovered_at INTEGER NOT NULL,
      current INTEGER NOT NULL CHECK (current IN (0, 1))
    );
    CREATE UNIQUE INDEX links_identity ON links(environment_id, COALESCE(url, ''));
    CREATE INDEX links_url ON links(url);`,
  ]);
  const prune = () =>
    db
      .prepare(
        "DELETE FROM snapshots WHERE NOT EXISTS (SELECT 1 FROM links WHERE links.url = snapshots.url)",
      )
      .run();
  prune();
  return {
    currentLinks() {
      return db
        .prepare("SELECT environment_id, branch FROM links WHERE current = 1")
        .all()
        .map((row) =>
          z
            .object({
              environment_id: z.string(),
              branch: z.string().nullable(),
            })
            .parse(row),
        );
    },
    environmentIds() {
      return db
        .prepare("SELECT DISTINCT environment_id FROM links")
        .all()
        .map(
          (row) =>
            z.object({ environment_id: z.string() }).parse(row).environment_id,
        );
    },
    snapshots() {
      return db
        .prepare("SELECT * FROM snapshots")
        .all()
        .map((raw) => {
          const row = snapshotRow.parse(raw);
          return {
            pullRequest: pullRequestSchema.parse(JSON.parse(row.content)),
            fetchedAt: row.fetched_at,
            lastChangedAt: row.last_changed_at,
          };
        });
    },
    links() {
      return db
        .prepare("SELECT * FROM links ORDER BY discovered_at DESC")
        .all()
        .map((raw) => {
          const row = linkRow.parse(raw);
          return {
            environmentId: row.environment_id,
            url: row.url,
            branch: row.branch,
            discoveredAt: row.discovered_at,
            current: row.current,
          };
        });
    },
    saveSnapshot(
      pullRequest: PullRequest,
      fetchedAt: number,
      lastChangedAt: number,
    ) {
      db.prepare(`INSERT INTO snapshots (url, content, fetched_at, last_changed_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET content = excluded.content, fetched_at = excluded.fetched_at,
        last_changed_at = excluded.last_changed_at WHERE snapshots.content != excluded.content`).run(
        pullRequest.url,
        JSON.stringify(pullRequest),
        fetchedAt,
        lastChangedAt,
      );
    },
    link(
      environmentId: string,
      url: string | null,
      branch: string | null,
      discoveredAt: number,
    ) {
      db.transaction(() => {
        db.prepare(
          "UPDATE links SET current = 0 WHERE environment_id = ? AND current = 1 AND (url IS NOT ? OR branch IS NOT ?)",
        ).run(environmentId, url, branch);
        db.prepare(
          "DELETE FROM links WHERE environment_id = ? AND url IS NULL AND ? IS NOT NULL",
        ).run(environmentId, url);
        db.prepare(`INSERT INTO links (environment_id, url, source, branch, discovered_at, current)
          VALUES (?, ?, 'current-branch', ?, ?, 1) ON CONFLICT DO UPDATE SET current = 1,
          branch = excluded.branch, discovered_at = excluded.discovered_at
          WHERE links.current != 1 OR links.branch IS NOT excluded.branch`).run(
          environmentId,
          url,
          branch,
          discoveredAt,
        );
      })();
    },
    removeEnvironment(environmentId: string) {
      db.transaction(() => {
        db.prepare("DELETE FROM links WHERE environment_id = ?").run(
          environmentId,
        );
        prune();
      })();
    },
    prune,
  };
}
export type PullRequestPersistence = ReturnType<
  typeof createPullRequestPersistence
>;
