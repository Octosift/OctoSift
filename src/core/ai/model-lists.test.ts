import { describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../db/client';
import { forgetModelList, storedModelList, storeModelList, textModels } from './model-lists';

describe('model lists', () => {
  it('keeps only text models from an OpenAI list', () => {
    expect(
      textModels('openai', ['gpt-6-luna', 'text-embedding-3-small', 'gpt-image-2', 'gpt-6-luna']),
    ).toEqual(['gpt-6-luna']);
    expect(textModels('anthropic', ['claude-sonnet-5-5', 'claude-haiku-5-5'])).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
    ]);
  });

  it('stores and forgets each provider separately', () => {
    const db = openMemoryDatabase();
    expect(storedModelList(db, 'openai')).toBeNull();
    storeModelList(db, 'openai', ['gpt-6.1-sol', 'gpt-6-luna'], 100);
    storeModelList(db, 'anthropic', ['claude-haiku-5-5'], 100);
    expect(storedModelList(db, 'openai')).toEqual(['gpt-6-luna', 'gpt-6.1-sol']);
    forgetModelList(db, 'openai');
    expect(storedModelList(db, 'openai')).toBeNull();
    expect(storedModelList(db, 'anthropic')).toEqual(['claude-haiku-5-5']);
    forgetModelList(db, 'anthropic');
    expect(storedModelList(db, 'anthropic')).toBeNull();
  });
});
