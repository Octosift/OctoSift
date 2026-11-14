import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { usage } from '../db/schema';
import { createFakeClock } from '../testing/fake-clock';
import { createUsageLedger, priceFor, type PriceTable } from './usage';

const PRICES: PriceTable = {
  'small-model': { inputPerMillionUsd: 1, outputPerMillionUsd: 4 },
  'anthropic/strong-model': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
};

function setup(caps = { perRunUsd: 0.5, perDayUsd: 3 }) {
  const db = openMemoryDatabase();
  const clock = createFakeClock();
  const make = (runId: string | null) =>
    createUsageLedger({ db, clock, runId, prices: () => PRICES, caps: () => caps });
  return { db, clock, make };
}

const small = { provider: 'openai' as const, model: 'small-model' };

describe('priceFor', () => {
  it('prefers a provider-qualified entry and falls back to the bare model id', () => {
    expect(priceFor(PRICES, { provider: 'anthropic', model: 'strong-model' })).toEqual(
      PRICES['anthropic/strong-model'],
    );
    expect(priceFor(PRICES, small)).toEqual(PRICES['small-model']);
    expect(priceFor(PRICES, { provider: 'google', model: 'unknown' })).toBeNull();
  });
});

describe('usage ledger', () => {
  it('records tokens and the cost from the price table', () => {
    const { db, make } = setup();
    const ledger = make(null);
    const cost = ledger.record('triage', small, { inputTokens: 1_000_000, outputTokens: 250_000 });
    expect(cost).toBeCloseTo(2);
    const [row] = db.select().from(usage).all();
    expect(row).toMatchObject({
      runId: null,
      stage: 'triage',
      provider: 'openai',
      model: 'small-model',
      inputTokens: 1_000_000,
      outputTokens: 250_000,
    });
    expect(ledger.summary()).toEqual({ costUsd: 2, incomplete: false, calls: 1 });
  });

  it('records an unknown price as unknown and marks the run total incomplete', () => {
    const { db, make } = setup();
    const ledger = make(null);
    const mystery = { provider: 'google' as const, model: 'mystery' };
    expect(ledger.record('qualify', mystery, { inputTokens: 10, outputTokens: 5 })).toBeNull();
    expect(db.select().from(usage).get()?.costUsd).toBeNull();
    expect(ledger.summary()).toEqual({ costUsd: 0, incomplete: true, calls: 1 });
  });

  it('stops a run once its budget is reached', () => {
    const { make } = setup({ perRunUsd: 0.5, perDayUsd: 100 });
    const ledger = make(null);
    expect(ledger.check()).toEqual({ ok: true });
    ledger.record('qualify', small, { inputTokens: 500_000, outputTokens: 0 });
    const result = ledger.check();
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/\$0\.50/);
  });

  it('stops when spending across runs in the last 24 hours reaches the daily cap', () => {
    const { make } = setup({ perRunUsd: 100, perDayUsd: 3 });
    make(null).record('qualify', small, { inputTokens: 3_000_000, outputTokens: 0 });
    const result = make(null).check();
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/daily/i);
  });

  it('keeps totals without writing anything when persistence is off', () => {
    const db = openMemoryDatabase();
    const ledger = createUsageLedger({
      db,
      clock: createFakeClock(),
      runId: null,
      prices: () => PRICES,
      caps: () => ({ perRunUsd: 1, perDayUsd: 1 }),
      persist: false,
    });
    ledger.record('triage', small, { inputTokens: 1_000_000, outputTokens: 0 });
    expect(ledger.summary().costUsd).toBe(1);
    expect(db.select().from(usage).all()).toEqual([]);
  });

  it('ignores spending older than 24 hours for the daily cap', () => {
    const { make, clock } = setup({ perRunUsd: 100, perDayUsd: 3 });
    make(null).record('qualify', small, { inputTokens: 3_000_000, outputTokens: 0 });
    clock.advance(24 * 3600 * 1000 + 1000);
    expect(make(null).check()).toEqual({ ok: true });
  });
});
