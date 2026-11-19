/**
 * Every user-editable, non-secret setting: its schema and its default.
 *
 * Schemas validate input at the boundary (forms, CLI, stored JSON). Defaults
 * come from CONFIG so the two never drift apart. A few settings can be
 * overridden per product; those fall back to the global value.
 */
import { z } from 'zod';
import { CONFIG } from '../config';
import { REPLY_LENGTHS } from '../db/schema';
import { normalizeWebUrl } from '../urls';

export const PROVIDER_IDS = ['openai', 'anthropic', 'openai_compatible', 'codex_cli'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const AI_STAGES = ['triage', 'qualify', 'draft', 'review'] as const;
export type AiStage = (typeof AI_STAGES)[number];

const subredditName = z
  .string()
  .trim()
  .transform((name) => name.replace(/^\/?r\//i, '').toLowerCase())
  .pipe(
    z.string().regex(/^[a-z0-9_]{2,21}$/, 'Subreddit names use letters, digits and underscores'),
  );

const stageModel = z
  .object({ provider: z.enum(PROVIDER_IDS), model: z.string().trim().min(1, 'Enter a model id') })
  .nullable();

const thresholds = z
  .object({
    show: z.number().int().min(0).max(100),
    draft: z.number().int().min(0).max(100),
    notify: z.number().int().min(0).max(100),
  })
  .refine((value) => value.draft >= value.show, {
    message: 'The draft threshold must be at least the inbox threshold',
    path: ['draft'],
  })
  .refine((value) => value.notify >= value.show, {
    message: 'The notification threshold must be at least the inbox threshold',
    path: ['notify'],
  });

const price = z.object({
  inputPerMillionUsd: z.number().min(0),
  outputPerMillionUsd: z.number().min(0),
  /** The rate for input served from the provider's prompt cache, when it has one. */
  cachedInputPerMillionUsd: z.number().min(0).optional(),
});

const codexEffort = z.enum(['low', 'medium', 'high']);

const phraseList = z.array(z.string().trim().min(1).max(200)).max(200);

function setting<S extends z.ZodType>(schema: S, defaultValue: z.output<S>) {
  return { schema, defaultValue };
}

export const SETTINGS = {
  'schedule.intervalMinutes': setting(
    z
      .number()
      .int()
      .min(
        CONFIG.schedule.minIntervalMinutes,
        `Scans can run at most every ${CONFIG.schedule.minIntervalMinutes} minutes`,
      )
      .max(24 * 60),
    CONFIG.schedule.defaultIntervalMinutes,
  ),
  'budget.perRunUsd': setting(z.number().min(0).max(1000), CONFIG.budget.perRunUsd),
  'budget.perDayUsd': setting(z.number().min(0).max(10_000), CONFIG.budget.perDayUsd),
  thresholds: setting(thresholds, { ...CONFIG.thresholds }),
  'prefilter.maxPostAgeHours': setting(
    z
      .number()
      .int()
      .min(1)
      .max(24 * 30),
    CONFIG.prefilter.maxPostAgeHours,
  ),
  'prefilter.languages': setting(z.array(z.string().trim().toLowerCase().length(2)).min(1), [
    ...CONFIG.prefilter.defaultLanguages,
  ]),
  blocklist: setting(z.object({ subreddits: z.array(subredditName), terms: phraseList }), {
    subreddits: [],
    terms: [],
  }),
  vetoPhrases: setting(phraseList, []),
  replyPreferences: setting(
    z.object({
      includeLinks: z.boolean(),
      /** Null means automatic: off for consumer products, on otherwise. */
      dmDrafts: z.boolean().nullable(),
      /** Saved before lengths existed means medium. */
      length: z.enum(REPLY_LENGTHS).default('medium'),
    }),
    { includeLinks: true, dmDrafts: null, length: 'medium' },
  ),
  /** The preferred way of reading Reddit; others are tried after it when failover is on. */
  'reddit.source': setting(z.enum(['session', 'rss']), 'session'),
  'reddit.failover': setting(z.boolean(), true),
  'reddit.userAgent': setting(z.string().trim().min(10).max(400), CONFIG.reddit.defaultUserAgent),
  'reddit.ownUsername': setting(
    z
      .string()
      .trim()
      .transform((name) => name.replace(/^\/?u\//i, ''))
      .pipe(z.string().regex(/^[A-Za-z0-9_-]{3,20}$/, 'Reddit usernames are 3 to 20 characters'))
      .nullable(),
    null,
  ),
  'ai.stages': setting(
    z.object({ triage: stageModel, qualify: stageModel, draft: stageModel, review: stageModel }),
    { triage: null, qualify: null, draft: null, review: null },
  ),
  'ai.compatibleBaseUrl': setting(
    z.preprocess(
      (value) => (typeof value === 'string' ? (normalizeWebUrl(value) ?? value) : value),
      z.url('Enter the endpoint address, for example localhost:11434/v1').nullable(),
    ),
    null,
  ),
  'ai.prices': setting(z.record(z.string().min(1), price), {}),
  /** Reasoning effort per stage for the experimental Codex CLI provider. */
  'ai.codexEffort': setting(
    z.object({
      triage: codexEffort,
      qualify: codexEffort,
      draft: codexEffort,
      review: codexEffort,
    }),
    { triage: 'low', qualify: 'medium', draft: 'medium', review: 'low' },
  ),
  'ai.imageDescriptions': setting(z.boolean(), CONFIG.images.enabledByDefault),
  /** Searches to check for evergreen threads; empty means the product's buyer phrases. */
  'evergreen.keywords': setting(
    z.array(z.string().trim().min(2).max(100)).max(CONFIG.serp.maxKeywords),
    [],
  ),
  'notify.format': setting(z.enum(['slack', 'discord']), 'slack'),
  /** Asks GitHub once a day whether a newer release exists. */
  'updates.check': setting(z.boolean(), true),
  'onboarding.completed': setting(z.boolean(), false),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS)[K]['schema']>;
export type SettingInput<K extends SettingKey> = z.input<(typeof SETTINGS)[K]['schema']>;

/** Settings a product may override; the product value wins when present. */
export const PRODUCT_SETTING_KEYS = [
  'thresholds',
  'vetoPhrases',
  'replyPreferences',
  'evergreen.keywords',
] as const;
export type ProductSettingKey = (typeof PRODUCT_SETTING_KEYS)[number];

export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SETTINGS, value);
}
