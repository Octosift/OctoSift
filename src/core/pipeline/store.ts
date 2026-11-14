/**
 * Every write a scan makes, behind one interface.
 *
 * A normal scan writes to the database. A dry run uses the in-memory store:
 * it remembers posts and verdicts for the rest of the scan so the funnel
 * still works, but the database only receives the run row.
 */
import type { Db } from '../db/client';
import * as evaluationQueries from '../db/queries/evaluations';
import * as imageQueries from '../db/queries/images';
import type { ImageDescriptionRow } from '../db/queries/images';
import * as leadQueries from '../db/queries/leads';
import * as postQueries from '../db/queries/posts';
import * as subredditQueries from '../db/queries/subreddits';
import type { EvaluationRow } from '../db/queries/evaluations';
import type { NewLead } from '../db/queries/leads';
import type { PostRow } from '../db/queries/posts';
import type { StageRecord } from './dedup';
import type { SubredditStatus } from '../db/schema';

export interface ScanStore {
  insertPosts(rows: PostRow[]): void;
  recordPoll(name: string, update: Parameters<typeof subredditQueries.recordPoll>[2]): void;
  setSubredditStatus(name: string, status: SubredditStatus): void;
  setBlockUntil(names: string[], blockUntil: number): void;
  saveEvaluation(row: EvaluationRow): void;
  insertLead(lead: NewLead): boolean;
  insertDraft(draft: Parameters<typeof leadQueries.insertDraft>[1]): number;
  updateLead(id: string, changes: Parameters<typeof leadQueries.updateLead>[2], now: number): void;
  saveImageDescription(row: ImageDescriptionRow): void;
  /** Replaces a stored preview with the full post. */
  completePost(row: PostRow): void;
  /** Reads that must see this scan's own unsaved writes in a dry run. */
  imageDescription(url: string): string | null;
  getPosts(ids: string[]): PostRow[];
  stageRecords(productId: string, postIds: string[]): Map<string, StageRecord[]>;
}

export function createDbStore(db: Db): ScanStore {
  return {
    insertPosts: (rows) => postQueries.insertPosts(db, rows),
    recordPoll: (name, update) => subredditQueries.recordPoll(db, name, update),
    setSubredditStatus: (name, status) => subredditQueries.setSubredditStatus(db, name, status),
    setBlockUntil: (names, until) => subredditQueries.setBlockUntil(db, names, until),
    saveEvaluation: (row) => evaluationQueries.saveEvaluation(db, row),
    insertLead: (lead) => leadQueries.insertLead(db, lead),
    insertDraft: (draft) => leadQueries.insertDraft(db, draft),
    updateLead: (id, changes, now) => leadQueries.updateLead(db, id, changes, now),
    saveImageDescription: (row) => imageQueries.saveImageDescription(db, row),
    completePost: (row) => postQueries.completePost(db, row),
    imageDescription: (url) => imageQueries.getImageDescription(db, url)?.description ?? null,
    getPosts: (ids) => postQueries.getPosts(db, ids),
    stageRecords: (productId, ids) => evaluationQueries.stageRecords(db, productId, ids),
  };
}

export function createDryRunStore(db: Db): ScanStore {
  const posts = new Map<string, PostRow>();
  const records = new Map<string, StageRecord[]>();
  const images = new Map<string, string>();
  const key = (productId: string, postId: string) => `${productId}\u0000${postId}`;
  return {
    insertPosts: (rows) => {
      for (const row of rows) if (!posts.has(row.id)) posts.set(row.id, row);
    },
    recordPoll: () => undefined,
    setSubredditStatus: () => undefined,
    setBlockUntil: () => undefined,
    saveEvaluation: (row) => {
      const id = key(row.productId, row.postId);
      const list = (records.get(id) ?? []).filter((record) => record.stage !== row.stage);
      list.push({ stage: row.stage, verdict: row.verdict, reason: row.reason });
      records.set(id, list);
    },
    insertLead: () => true,
    insertDraft: () => 1,
    updateLead: () => undefined,
    saveImageDescription: (row) => {
      images.set(row.url, row.description);
    },
    completePost: (row) => {
      posts.set(row.id, { ...row, partial: false });
    },
    imageDescription: (url) =>
      images.get(url) ?? imageQueries.getImageDescription(db, url)?.description ?? null,
    getPosts: (ids) => {
      const stored = postQueries.getPosts(db, ids);
      const found = new Set(stored.map((row) => row.id));
      return [...stored, ...ids.flatMap((id) => (found.has(id) ? [] : (posts.get(id) ?? [])))];
    },
    stageRecords: (productId, ids) => {
      const fromDb = evaluationQueries.stageRecords(db, productId, ids);
      for (const id of ids) {
        const local = records.get(key(productId, id));
        if (local) fromDb.set(id, local);
      }
      return fromDb;
    },
  };
}
