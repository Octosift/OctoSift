'use client';

import { LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { CONFIG } from '@/core/config';
import { Button } from '../components/ui/button';
import { Badge, Banner, Card } from '../components/ui/display';
import { Checkbox, Input } from '../components/ui/fields';
import { saveSubreddits, suggestForProduct } from '../lib/actions/onboarding';
import { stepHref } from './steps';

interface Candidate {
  name: string;
  reason: string;
  strictness: string;
  /** Typed in by the user, so a late suggestion list never removes it. */
  own: boolean;
}

const { minSelected, maxSelected, preselected } = CONFIG.subreddits;

/**
 * Suggestions arrive once, from one AI call; until then the user can add
 * their own. Nothing is read from Reddit here: the first scan reads the saved
 * subreddits and reports any that do not exist, so each is read only once.
 */
export function StepSubreddits({ productId, saved }: { productId: string; saved: string[] }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>(
    saved.map((name) => ({ name, reason: 'Already saved', strictness: 'unknown', own: true })),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(saved));
  const [custom, setCustom] = useState('');
  const [loading, setLoading] = useState(saved.length === 0);
  const [waitedS, setWaitedS] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (saved.length > 0) return;
    let cancelled = false;
    // The server shares one AI call between repeated requests, so a second mount costs nothing.
    void suggestForProduct(productId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(`${result.message} Add subreddits yourself below, or try again later.`);
        return;
      }
      const suggested = result.suggestions.map((s) => ({
        name: s.name,
        reason: s.reason,
        strictness: s.promotionStrictness,
        own: false,
      }));
      setCandidates((current) => {
        const names = new Set(suggested.map((s) => s.name));
        return [...suggested, ...current.filter((c) => c.own && !names.has(c.name))];
      });
      // Keep what the user picked while waiting; add the best matches up to the limit.
      setSelected((current) => {
        const next = new Set(current);
        for (const s of suggested.slice(0, preselected)) {
          if (next.size >= maxSelected) break;
          next.add(s.name);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [productId, saved.length]);

  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => {
      setWaitedS((seconds) => seconds + 1);
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [loading]);

  function toggle(name: string, on: boolean) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function addCustom() {
    const name = custom
      .trim()
      .replace(/^(https?:\/\/)?((www|old)\.)?(reddit\.com)?\/?r\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
    if (!/^[a-z0-9_]{2,21}$/.test(name)) {
      setError('Subreddit names use letters, digits and underscores.');
      return;
    }
    setError(null);
    setCandidates((list) =>
      list.some((c) => c.name === name)
        ? list
        : [...list, { name, reason: 'Added by you', strictness: 'unknown', own: true }],
    );
    toggle(name, true);
    setCustom('');
  }

  function save() {
    startTransition(async () => {
      const result = await saveSubreddits({ productId, names: [...selected] });
      if (result.ok) {
        router.push(stepHref('scan'));
        router.refresh();
      } else {
        setError(result.error ?? 'Could not save.');
      }
    });
  }

  return (
    <section aria-labelledby="step-subreddits" className="flex flex-col gap-4">
      <div>
        <h2 id="step-subreddits" className="text-xl font-semibold tracking-tight">
          Where do your customers ask questions?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The best matches are ticked. Untick any that look wrong or add your own; {minSelected} to{' '}
          {maxSelected} work best. The first scan tells you if one does not exist.
        </p>
      </div>
      {loading ? (
        <Banner role="status">
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
          <span>
            Asking your AI model for subreddits that fit your product… {waitedS} s. This is one call
            and usually takes under a minute. You can add your own below meanwhile.
          </span>
        </Banner>
      ) : null}
      {candidates.length > 0 ? (
        <Card>
          <ul className="divide-y divide-border">
            {candidates.map((candidate) => (
              <li key={candidate.name} className="flex items-start gap-3 px-4 py-2.5">
                <Checkbox
                  id={`sub-${candidate.name}`}
                  className="mt-1"
                  checked={selected.has(candidate.name)}
                  onChange={(event) => {
                    toggle(candidate.name, event.target.checked);
                  }}
                />
                <label htmlFor={`sub-${candidate.name}`} className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium">
                    r/{candidate.name}
                    {candidate.strictness !== 'unknown' ? (
                      <Badge tone="outline">{candidate.strictness} about promotion</Badge>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{candidate.reason}</span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          addCustom();
        }}
      >
        <Input
          aria-label="Add a subreddit"
          placeholder="Add a subreddit, e.g. r/freelance"
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value);
          }}
        />
        <Button type="submit">Add</Button>
      </form>
      {error ? (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            router.push(stepHref('scan'));
          }}
        >
          Skip for now
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular">{selected.size} selected</span>
          <Button
            variant="primary"
            onClick={save}
            disabled={pending || selected.size < minSelected || selected.size > maxSelected}
          >
            Save and continue
          </Button>
        </div>
      </div>
    </section>
  );
}
