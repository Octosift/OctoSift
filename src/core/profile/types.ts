/** The product profile every AI stage works from. */
import { z } from 'zod';
import { profileWire } from '../ai/schemas';

export const productProfileSchema = profileWire.extend({
  url: z.string(),
  /** Interview answers; all optional for the user. */
  best_customer: z.string().default(''),
  misconceptions: z.string().default(''),
  never_reply_to: z.string().default(''),
  include_links: z.boolean().default(true),
  reddit_username: z.string().nullable().default(null),
  /** Answers to the extraction's open questions, as "question answer" lines. */
  founder_notes: z.array(z.string()).default([]),
  /** Under 200 words; the only profile text triage sees. */
  short: z.string(),
});

export type ProductProfile = z.output<typeof productProfileSchema>;
