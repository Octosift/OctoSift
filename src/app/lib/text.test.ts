import { describe, expect, it } from 'vitest';
import { highlightQuote, intentLabel, scoreTone, wordCount } from './text';

describe('highlightQuote', () => {
  const body = 'First line.\n\nIs there a tool that   sends reminders? Thanks.';

  it('marks the quote even when spacing and case differ', () => {
    expect(highlightQuote(body, '"is there a tool that sends reminders?"')).toEqual([
      { text: 'First line.\n\n', highlight: false },
      { text: 'Is there a tool that   sends reminders?', highlight: true },
      { text: ' Thanks.', highlight: false },
    ]);
  });

  it('returns the text unmarked when the quote is missing or empty', () => {
    expect(highlightQuote(body, 'a paraphrase')).toEqual([{ text: body, highlight: false }]);
    expect(highlightQuote(body, '  ')).toEqual([{ text: body, highlight: false }]);
  });

  it('treats regular expression characters in the quote literally', () => {
    expect(highlightQuote('Cost (per month) is $5?', '(per month) is $5?')[1]).toEqual({
      text: '(per month) is $5?',
      highlight: true,
    });
  });
});

describe('labels and tones', () => {
  it('describes intents in plain words', () => {
    expect(intentLabel('asking_for_recommendation')).toBe('Asks for a tool');
    expect(intentLabel('something_new')).toBe('something_new');
  });

  it('picks a stronger tone for higher scores', () => {
    expect([90, 80, 65].map(scoreTone)).toEqual(['strong', 'brand', 'neutral']);
  });

  it('counts words', () => {
    expect(wordCount('One, two  three - four.')).toBe(4);
  });
});
