/**
 * Makes sure each post is judged once per product.
 *
 * By id: the evaluation rows of a post say where its processing stopped.
 * Final verdicts are never revisited; an `error` verdict means "try that
 * stage again on the next scan".
 *
 * By content: the same post is often cross-posted to several subreddits.
 * A hash of the normalised title and the start of the body identifies
 * copies; the oldest copy is evaluated and the others are marked as
 * cross-posts of it.
 */
import { createHash } from 'node:crypto';
import { CONFIG } from '../config';
import type { EvaluationStage, EvaluationVerdict } from '../db/schema';

export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentHash(title: string, body: string): string {
  const normalizedBody = normalizeForHash(body).slice(0, CONFIG.dedup.hashBodyChars);
  return createHash('sha256')
    .update(`${normalizeForHash(title)}\n${normalizedBody}`)
    .digest('hex');
}

export interface HashedPost {
  id: string;
  subreddit: string;
  createdAt: number;
  contentHash: string;
}

/**
 * Maps each incoming post that copies an older post from another subreddit
 * to the id of that older post.
 */
export function findCrossposts(
  incoming: HashedPost[],
  existing: HashedPost[],
): Map<string, string> {
  const byHash = new Map<string, HashedPost[]>();
  for (const post of [...existing, ...incoming]) {
    const group = byHash.get(post.contentHash) ?? [];
    group.push(post);
    byHash.set(post.contentHash, group);
  }
  const result = new Map<string, string>();
  for (const post of incoming) {
    const group = byHash.get(post.contentHash) ?? [];
    const original = group
      .filter((other) => other.subreddit !== post.subreddit)
      .filter(
        (other) =>
          other.createdAt < post.createdAt ||
          (other.createdAt === post.createdAt && other.id < post.id),
      )
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0];
    if (original) result.set(post.id, original.id);
  }
  return result;
}

export interface StageRecord {
  stage: EvaluationStage;
  verdict: EvaluationVerdict;
  reason: string;
}

export type ResumePoint = 'prefilter' | 'triage' | 'qualify' | 'done';

/** Where a post's evaluation for one product should continue. */
export function resumeStage(rows: StageRecord[]): ResumePoint {
  const at = (stage: EvaluationStage) => rows.find((row) => row.stage === stage);
  const prefilterRow = at('prefilter');
  if (!prefilterRow || prefilterRow.verdict === 'error') return 'prefilter';
  if (prefilterRow.verdict === 'skip' || prefilterRow.reason === 'brand_mention') return 'done';
  const triageRow = at('triage');
  if (!triageRow || triageRow.verdict === 'error') return 'triage';
  if (triageRow.verdict === 'skip') return 'done';
  const qualifyRow = at('qualify');
  if (!qualifyRow || qualifyRow.verdict === 'error') return 'qualify';
  return 'done';
}
