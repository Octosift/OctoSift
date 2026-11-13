/** Whole-database operations behind "export" and "delete all data". */
import { like, not } from 'drizzle-orm';
import type { Db } from '../client';
import {
  drafts,
  evaluations,
  feedback,
  leads,
  posts,
  products,
  productSubreddits,
  replyChecks,
  runs,
  secrets,
  serpThreads,
  settings,
  subreddits,
  usage,
} from '../schema';

/** Everything the user created or collected, except secrets and internal state. */
export function exportData(db: Db) {
  return {
    products: db.select().from(products).all(),
    subreddits: db.select().from(subreddits).all(),
    productSubreddits: db.select().from(productSubreddits).all(),
    posts: db.select().from(posts).all(),
    evaluations: db.select().from(evaluations).all(),
    leads: db.select().from(leads).all(),
    drafts: db.select().from(drafts).all(),
    feedback: db.select().from(feedback).all(),
    runs: db.select().from(runs).all(),
    usage: db.select().from(usage).all(),
    settings: db
      .select()
      .from(settings)
      .where(not(like(settings.key, 'state.%')))
      .all(),
  };
}

export function deleteAllData(db: Db): void {
  db.$client
    .transaction(() => {
      for (const table of [
        replyChecks,
        serpThreads,
        drafts,
        feedback,
        leads,
        evaluations,
        usage,
        runs,
        productSubreddits,
        products,
        posts,
        subreddits,
        settings,
        secrets,
      ]) {
        db.delete(table).run();
      }
    })
    .immediate();
}
