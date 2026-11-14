/**
 * Built-in defaults and hard limits.
 *
 * Every number the pipeline relies on lives here so it can be read, reviewed
 * and tuned in one place. Values the user can change at runtime are stored in
 * the settings table; this file only supplies their starting point. The object
 * is deeply frozen so no module can change a default by accident.
 */

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

const HOUR_S = 60 * 60;
const DAY_S = 24 * HOUR_S;

export const CONFIG = deepFreeze({
  reddit: {
    baseUrl: 'https://www.reddit.com',
    /** Entries requested per feed. Reddit caps Atom feeds at 100. */
    feedLimit: 100,
    /** Logged-out budget is roughly one request every ten seconds. */
    minSpacingMs: 10_000,
    maxJitterMs: 3_000,
    /** How long every Reddit read pauses after a block or HTTP 429. */
    blockPauseMs: 10 * 60 * 1000,
    /** Network errors and 5xx responses are retried this many times. */
    maxRetries: 2,
    retryBaseDelayMs: 2_000,
    requestTimeoutMs: 20_000,
    cacheTtlMs: 120_000,
    /** Quiet subreddits are combined into one feed request, up to this many. */
    maxSubredditsPerRequest: 5,
    /** A new subreddit only contributes posts this recent on its first poll. */
    firstPollWindowS: 48 * HOUR_S,
    /** Reddit allows 40,000 characters in a post; anything longer is cut. */
    maxBodyChars: 40_000,
    /** Reddit archives posts after roughly six months; they take no replies. */
    archiveAfterS: 182 * DAY_S,
    defaultUserAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    blockMarkers: [
      'blocked by network security',
      'whoa there, pardner',
      "you've been blocked",
      'too many requests',
    ],
  },

  schedule: {
    defaultIntervalMinutes: 60,
    minIntervalMinutes: 15,
    workerTickMs: 60_000,
    /** How often the worker checks for "scan now" requests between ticks. */
    scanRequestPollMs: 3_000,
    /** How often the worker reports that it is alive, even in the middle of a scan. */
    workerHeartbeatMs: 5_000,
    /** A scan lock whose heartbeat is older than this is considered abandoned. */
    lockStaleAfterMs: 5 * 60 * 1000,
    lockHeartbeatMs: 30_000,
  },

  prefilter: {
    maxPostAgeHours: 48,
    /** Posts with more links than this to unknown domains are usually spam or SEO. */
    maxExternalLinks: 1,
    defaultLanguages: ['en'],
    /** Below this many characters language detection is unreliable, so it is skipped. */
    minCharsForLanguageCheck: 80,
    knownBots: ['automoderator'],
    linkAllowlist: [
      'reddit.com',
      'redd.it',
      'imgur.com',
      'youtube.com',
      'youtu.be',
      'github.com',
      'wikipedia.org',
      'stackoverflow.com',
      'google.com',
      'apple.com',
      'docs.google.com',
    ],
  },

  dedup: {
    /** Characters of the normalised body included in the content hash. */
    hashBodyChars: 200,
  },

  triage: {
    batchSize: 10,
    excerptChars: 600,
    maxReasonChars: 120,
  },

  profile: {
    shortMaxWords: 200,
  },

  qualify: {
    unverifiedQuotePenalty: 20,
  },

  score: {
    /** Multipliers by post age, checked in order; the last one applies to anything older. */
    freshness: [
      { maxAgeHours: 6, factor: 1 },
      { maxAgeHours: 24, factor: 0.9 },
      { maxAgeHours: 48, factor: 0.75 },
      { maxAgeHours: Number.POSITIVE_INFINITY, factor: 0.5 },
    ],
    flagPenalties: {
      low_effort_post: 10,
      outside_target_market: 10,
      sensitive_topic: 10,
      unverified_quote: 20,
      busy_thread: 5,
    },
    /** A thread with this many comments buries a late reply. */
    busyThreadComments: 100,
  },

  thresholds: {
    show: 60,
    draft: 75,
    notify: 85,
  },

  draft: {
    replyWords: { min: 40, max: 180 },
    dmWords: { min: 25, max: 90 },
    maxRegenerations: 1,
    disclosurePhrases: [
      "i'm the maker",
      'i am the maker',
      "i'm the founder",
      'i am the founder',
      "i'm the creator",
      'i am the creator',
      "i'm the developer",
      'i am the developer',
      'i built',
      'i made',
      "i'm building",
      'i am building',
      "i'm one of the people behind",
      'disclosure:',
      'full disclosure',
    ],
    refusalPhrases: [
      "i can't help with",
      'i cannot help with',
      "i'm unable to",
      'i am unable to',
      "i can't assist",
      'i cannot assist',
      'as an ai',
    ],
    variationHints: [
      'Open with a direct answer to the question in the first sentence.',
      'Open with a short question back to the author, then answer it.',
      'Mention the product in the middle of the reply, not at the end.',
      'Start by naming the specific detail in the post that matters most.',
      'Keep it to two short paragraphs.',
      'Give one concrete step the author can take today before anything else.',
      'Briefly acknowledge the trade-off the author is facing, then answer.',
    ],
  },

  budget: {
    perRunUsd: 0.5,
    perDayUsd: 3,
  },

  ai: {
    /** A run stops when more than this share of AI calls fail. */
    maxFailureRatio: 0.3,
    /** The failure ratio is only judged after this many calls. */
    minCallsBeforeFailureCheck: 5,
    requestTimeoutMs: 60_000,
    /** The experimental CLI provider: one call at a time, killed after this long. */
    cliTimeoutMs: 180_000,
    /**
     * Posts per CLI call. Every call carries about 18,000 tokens of the CLI's
     * own instructions, so the CLI provider batches far more than the APIs.
     */
    cliBatch: { triage: 25, qualify: 5 },
    cliOverheadInputTokens: 18_000,
  },

  health: {
    scansWithoutLeadsBeforeWarning: 3,
    hoursWithoutFetchBeforeWarning: 24,
  },

  pacing: {
    sameSubredditMentionWindowDays: 7,
    maxMentionsPerSubredditInWindow: 1,
    maxMentionsPerDay: 3,
    helpfulPerMentionWindowDays: 14,
    helpfulRepliesPerMention: 3,
  },

  feedback: {
    maxRules: 20,
    goodExamples: 5,
    badExamples: 5,
  },

  crawl: {
    maxExtraPages: 5,
    maxCharsPerPage: 6_000,
    /** Bytes read from any one response; the rest is never downloaded. */
    maxBytesPerPage: 2_000_000,
    maxRedirects: 5,
    timeoutMs: 10_000,
    pageHints: ['pricing', 'price', 'plans', 'features', 'about', 'docs', 'faq', 'how-it-works'],
  },

  /** Reading with the user's connected Reddit account (JSON listings). */
  session: {
    hotPages: 3,
    topPages: 2,
    minSpacingMs: 8_000,
    maxJitterMs: 3_000,
    maxPerHour: 120,
    timeoutMs: 20_000,
    /** The sign-in window closes itself after this long. */
    signInTimeoutMs: 5 * 60_000,
  },

  /** Threads that rank on Google, from DataForSEO (optional). */
  serp: {
    locationCode: 2840, // United States
    languageCode: 'en',
    depth: 20,
    maxKeywords: 20,
    concurrency: 4,
    intervalDays: 7,
    timeoutMs: 60_000,
    /** A run still marked running after this long is treated as abandoned. */
    staleRunS: 15 * 60,
  },

  subreddits: {
    maxSuggestions: 15,
    /** Suggestions ticked for the user in onboarding; they only confirm. */
    preselected: 5,
    minSelected: 3,
    maxSelected: 10,
  },

  images: {
    enabledByDefault: false,
    maxDescriptionWords: 150,
  },

  notify: {
    maxAttempts: 2,
    timeoutMs: 10_000,
  },

  rules: {
    summaryCacheS: 30 * DAY_S,
  },

  /** Checks of posted replies and of the connected account, read with the session. */
  visibility: {
    replyChecks: [
      { kind: '1h', afterS: HOUR_S },
      { kind: '24h', afterS: DAY_S },
    ],
    /** Reply checks per worker tick; each waits its turn behind the session's pacing. */
    checksPerTick: 5,
    /** A check that could not run is tried again this much later, a few times. */
    retryAfterS: 30 * 60,
    maxAttempts: 3,
    profileCheckIntervalS: DAY_S,
    profileRecheckAfterS: 30 * 60,
    multiSubredditWindowDays: 7,
  },

  evergreen: {
    maxKeywords: 20,
    serpDepth: 20,
    intervalDays: 7,
  },

  inbox: {
    pageSize: 50,
  },
});

export type Config = typeof CONFIG;
