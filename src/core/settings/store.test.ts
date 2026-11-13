import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { writeSetting } from '../db/queries/settings';
import { CONFIG } from '../config';
import { createSettingsStore } from './store';

function setup() {
  const db = openMemoryDatabase();
  return { db, settings: createSettingsStore(db) };
}

describe('settings store', () => {
  it('returns the built-in default when nothing is stored', () => {
    const { settings } = setup();
    expect(settings.get('schedule.intervalMinutes')).toBe(CONFIG.schedule.defaultIntervalMinutes);
    expect(settings.get('budget.perRunUsd')).toBe(CONFIG.budget.perRunUsd);
    expect(settings.get('thresholds')).toEqual(CONFIG.thresholds);
  });

  it('stores and returns a valid value', () => {
    const { settings } = setup();
    expect(settings.set('budget.perDayUsd', 5)).toEqual({ ok: true });
    expect(settings.get('budget.perDayUsd')).toBe(5);
  });

  it('rejects an invalid value with a readable error and keeps the previous value', () => {
    const { settings } = setup();
    settings.set('schedule.intervalMinutes', 30);
    const result = settings.set('schedule.intervalMinutes', 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/15/);
    expect(settings.get('schedule.intervalMinutes')).toBe(30);
  });

  it('rejects thresholds where drafts would start below the inbox threshold', () => {
    const { settings } = setup();
    const result = settings.set('thresholds', { show: 80, draft: 70, notify: 90 });
    expect(result.ok).toBe(false);
  });

  it('falls back to the default when a stored value no longer matches its schema', () => {
    const { db, settings } = setup();
    writeSetting(db, 'budget.perRunUsd', 'not a number');
    expect(settings.get('budget.perRunUsd')).toBe(CONFIG.budget.perRunUsd);
  });

  it('lets a product override a global value and falls back to the global one', () => {
    const { settings } = setup();
    settings.set('thresholds', { show: 55, draft: 70, notify: 90 });
    expect(settings.getForProduct('p1', 'thresholds')).toEqual({ show: 55, draft: 70, notify: 90 });
    settings.setForProduct('p1', 'thresholds', { show: 65, draft: 80, notify: 95 });
    expect(settings.getForProduct('p1', 'thresholds')).toEqual({ show: 65, draft: 80, notify: 95 });
    expect(settings.getForProduct('p2', 'thresholds')).toEqual({ show: 55, draft: 70, notify: 90 });
  });

  it('says whether a product has its own value', () => {
    const { settings } = setup();
    expect(settings.isOverridden('p1', 'thresholds')).toBe(false);
    settings.setForProduct('p1', 'thresholds', { show: 65, draft: 80, notify: 95 });
    expect(settings.isOverridden('p1', 'thresholds')).toBe(true);
  });

  it('removes a product override', () => {
    const { settings } = setup();
    settings.setForProduct('p1', 'vetoPhrases', ['homework help']);
    settings.clearForProduct('p1', 'vetoPhrases');
    expect(settings.getForProduct('p1', 'vetoPhrases')).toEqual([]);
  });

  it('normalises subreddit names in the blocklist', () => {
    const { settings } = setup();
    settings.set('blocklist', { subreddits: ['r/Spam_Demo', ' other '], terms: ['crypto'] });
    expect(settings.get('blocklist').subreddits).toEqual(['spam_demo', 'other']);
  });

  it('stores the model chosen for each AI stage', () => {
    const { settings } = setup();
    expect(settings.get('ai.stages').triage).toBeNull();
    settings.set('ai.stages', {
      ...settings.get('ai.stages'),
      triage: { provider: 'openai_compatible', model: 'small-model' },
    });
    expect(settings.get('ai.stages').triage).toEqual({
      provider: 'openai_compatible',
      model: 'small-model',
    });
  });
});
