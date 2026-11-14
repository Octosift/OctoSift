/**
 * Database schema.
 *
 * Conventions: ids are text, timestamps are UTC epoch seconds, JSON columns
 * hold data validated at the boundary by Zod. Subreddit names are stored in
 * lower case without the "r/" prefix.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export type ReplyMode = 'helpful_only' | 'soft_mention' | 'direct';
export type LeadStatus = 'new' | 'drafted' | 'replied' | 'snoozed' | 'dismissed';
export type LeadKind = 'opportunity' | 'brand_mention';
export type EvaluationStage = 'prefilter' | 'triage' | 'qualify' | 'veto';
export type EvaluationVerdict = 'pass' | 'skip' | 'error';
export type DraftKind = 'reply' | 'dm';
export type ReviewDecision = 'APPROVE' | 'REVISE' | 'REJECT' | 'NOT_REVIEWED';
export type SubredditStatus = 'active' | 'paused' | 'gone';
export type PromotionPolicy = 'unknown' | 'allowed' | 'no_promotion';
export type RunTrigger = 'schedule' | 'manual' | 'cli' | 'onboarding';
export type RunStatus = 'running' | 'ok' | 'partial' | 'failed' | 'budget_stopped';

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  profileJson: text('profile_json', { mode: 'json' }).$type<unknown>().notNull(),
  /** The most promotional reply mode the user allows for this product. */
  mode: text('mode').$type<ReplyMode>().notNull().default('direct'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const subreddits = sqliteTable('subreddits', {
  name: text('name').primaryKey(),
  lastPolledAt: integer('last_polled_at'),
  lastNewestId: text('last_newest_id'),
  status: text('status').$type<SubredditStatus>().notNull().default('active'),
  blockUntil: integer('block_until'),
  /** Overrides the default poll interval; shortened for busy subreddits. */
  pollIntervalMinutes: integer('poll_interval_minutes'),
  postsPerDay: real('posts_per_day'),
  promotionPolicy: text('promotion_policy').$type<PromotionPolicy>().notNull().default('unknown'),
  rulesText: text('rules_text'),
  rulesSummaryJson: text('rules_summary_json', { mode: 'json' }).$type<unknown>(),
  rulesUpdatedAt: integer('rules_updated_at'),
  createdAt: integer('created_at').notNull(),
});

export const productSubreddits = sqliteTable(
  'product_subreddits',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    subreddit: text('subreddit')
      .notNull()
      .references(() => subreddits.name, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    addedAt: integer('added_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.subreddit] })],
);

export const posts = sqliteTable(
  'posts',
  {
    id: text('id').primaryKey(),
    subreddit: text('subreddit').notNull(),
    author: text('author').notNull(),
    title: text('title').notNull(),
    bodyText: text('body_text').notNull(),
    /** Links found in the body; the prefilter uses them to spot spam. */
    bodyLinksJson: text('body_links_json', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    url: text('url').notNull(),
    imageUrl: text('image_url'),
    createdAt: integer('created_at').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
    contentHash: text('content_hash').notNull(),
    /** Set when another stored post has the same content (a cross-post). */
    duplicateOf: text('duplicate_of'),
    /** Upvotes and comments when the source reports them; null otherwise. */
    score: integer('score'),
    commentCount: integer('comment_count'),
    nsfw: integer('nsfw', { mode: 'boolean' }).notNull().default(false),
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    index('posts_subreddit_created_idx').on(table.subreddit, table.createdAt),
    index('posts_content_hash_idx').on(table.contentHash),
  ],
);

export const evaluations = sqliteTable(
  'evaluations',
  {
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    stage: text('stage').$type<EvaluationStage>().notNull(),
    verdict: text('verdict').$type<EvaluationVerdict>().notNull(),
    reason: text('reason').notNull(),
    dataJson: text('data_json', { mode: 'json' }).$type<unknown>(),
    model: text('model'),
    runId: text('run_id'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.postId, table.stage] }),
    index('evaluations_run_idx').on(table.runId, table.stage),
  ],
);

export const leads = sqliteTable(
  'leads',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<LeadKind>().notNull().default('opportunity'),
    score: integer('score').notNull(),
    modelScore: integer('model_score').notNull(),
    fit: text('fit').notNull(),
    intent: text('intent').notNull(),
    reason: text('reason').notNull(),
    evidenceQuote: text('evidence_quote').notNull(),
    riskFlagsJson: text('risk_flags_json', { mode: 'json' }).$type<string[]>().notNull(),
    mentionOk: integer('mention_ok', { mode: 'boolean' }).notNull(),
    dmOk: integer('dm_ok', { mode: 'boolean' }).notNull(),
    suggestedAngle: text('suggested_angle').notNull().default(''),
    status: text('status').$type<LeadStatus>().notNull().default('new'),
    snoozedUntil: integer('snoozed_until'),
    dismissReason: text('dismiss_reason'),
    repliedAt: integer('replied_at'),
    /** Whether the reply the user posted mentioned the product; used for pacing. */
    repliedWithMention: integer('replied_with_mention', { mode: 'boolean' }),
    commentUrl: text('comment_url'),
    draftError: text('draft_error'),
    notifiedAt: integer('notified_at'),
    runId: text('run_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('leads_product_status_score_idx').on(table.productId, table.status, table.score),
    uniqueIndex('leads_product_post_idx').on(table.productId, table.postId),
  ],
);

export const drafts = sqliteTable(
  'drafts',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<DraftKind>().notNull(),
    text: text('text').notNull(),
    mode: text('mode').$type<ReplyMode>().notNull(),
    mentionsProduct: integer('mentions_product', { mode: 'boolean' }).notNull(),
    includesLink: integer('includes_link', { mode: 'boolean' }).notNull(),
    notesForUser: text('notes_for_user').notNull().default(''),
    /** True when deterministic checks still failed after regeneration. */
    needsEdit: integer('needs_edit', { mode: 'boolean' }).notNull().default(false),
    checkFailuresJson: text('check_failures_json', { mode: 'json' }).$type<string[]>().notNull(),
    reviewDecision: text('review_decision').$type<ReviewDecision>(),
    reviewReasonsJson: text('review_reasons_json', { mode: 'json' }).$type<string[]>().notNull(),
    editedByUser: integer('edited_by_user', { mode: 'boolean' }).notNull().default(false),
    version: integer('version').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('drafts_lead_kind_idx').on(table.leadId, table.kind, table.version)],
);

export const feedback = sqliteTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    leadId: text('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    signal: text('signal').$type<'good' | 'bad'>().notNull(),
    note: text('note').notNull().default(''),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('feedback_product_created_idx').on(table.productId, table.createdAt)],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    trigger: text('trigger').$type<RunTrigger>().notNull(),
    status: text('status').$type<RunStatus>().notNull(),
    dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false),
    countsJson: text('counts_json', { mode: 'json' }).$type<unknown>().notNull(),
    costUsd: real('cost_usd').notNull().default(0),
    /** True when at least one AI call had no known price. */
    costIncomplete: integer('cost_incomplete', { mode: 'boolean' }).notNull().default(false),
    error: text('error'),
  },
  (table) => [index('runs_started_idx').on(table.startedAt)],
);

export const usage = sqliteTable(
  'usage',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    stage: text('stage').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    /** Null when the model has no known price. */
    costUsd: real('cost_usd'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('usage_created_idx').on(table.createdAt),
    index('usage_run_idx').on(table.runId),
  ],
);

/** Descriptions of post images, so each image is described once. */
export const imageDescriptions = sqliteTable('image_descriptions', {
  url: text('url').primaryKey(),
  description: text('description').notNull(),
  model: text('model').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json', { mode: 'json' }).$type<unknown>().notNull(),
});

export const secrets = sqliteTable('secrets', {
  name: text('name').primaryKey(),
  /** AES-256-GCM ciphertext followed by the 16-byte authentication tag, base64. */
  ciphertext: text('ciphertext').notNull(),
  nonce: text('nonce').notNull(),
  createdAt: integer('created_at').notNull(),
});

export type SerpRunStatus = 'running' | 'ok' | 'partial' | 'failed';
export type SerpRunTrigger = 'schedule' | 'manual';

/** One check of the buyer keywords against Google, with the cost DataForSEO reported. */
export const serpRuns = sqliteTable(
  'serp_runs',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    trigger: text('trigger').$type<SerpRunTrigger>().notNull(),
    status: text('status').$type<SerpRunStatus>().notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    keywords: integer('keywords').notNull(),
    threads: integer('threads').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    error: text('error'),
  },
  (table) => [index('serp_runs_product_started_idx').on(table.productId, table.startedAt)],
);

/** A Reddit thread that ranked for a keyword; updated in place on every check. */
export const serpThreads = sqliteTable(
  'serp_threads',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    keyword: text('keyword').notNull(),
    url: text('url').notNull(),
    postId: text('post_id'),
    subreddit: text('subreddit').notNull().default(''),
    title: text('title').notNull().default(''),
    rank: integer('rank').notNull(),
    /** When Google shows a date for the thread. */
    publishedAt: integer('published_at'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    runId: text('run_id').references(() => serpRuns.id, { onDelete: 'set null' }),
    checkedAt: integer('checked_at').notNull(),
  },
  (table) => [
    index('serp_threads_product_keyword_idx').on(table.productId, table.keyword),
    uniqueIndex('serp_threads_product_keyword_url_idx').on(
      table.productId,
      table.keyword,
      table.url,
    ),
  ],
);

export const replyChecks = sqliteTable(
  'reply_checks',
  {
    id: text('id').primaryKey(),
    leadId: text('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    commentUrl: text('comment_url').notNull(),
    dueAt: integer('due_at').notNull(),
    kind: text('kind').notNull(),
    /** visible, removed, post_gone or unknown; null until checked. */
    result: text('result'),
    checkedAt: integer('checked_at'),
    /** Failed tries so far; the check gives up as unknown after a few. */
    attempts: integer('attempts').notNull().default(0),
  },
  (table) => [index('reply_checks_due_idx').on(table.dueAt)],
);
