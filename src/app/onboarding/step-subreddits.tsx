'use client';

import { CircleAlert, CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { CONFIG } from '@/core/config';
import type { ValidationProgress } from '@/core/validation-queue';
import { Button } from '../components/ui/button';
import { Badge, Banner, Card } from '../components/ui/display';
import { Checkbox, Input } from '../components/ui/fields';
import {
  checkProgress,
  checkSubreddits,
  saveSubreddits,
  suggestForProduct,
} from '../lib/actions/onboarding';
import { stepHref } from './steps';

interface Candidate {
  name: string;
  reason: string;
  strictness: string;
}

const { minSelected, maxSelected, preselected } = CONFIG.subreddits;

export function StepSubreddits({ productId, saved }: { productId: string; saved: string[] }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>(
    saved.map((name) => ({ name, reason: 'Already saved', strictness: 'unknown' })),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(saved));
  const [custom, setCustom] = useState('');
  const [loading, setLoading] = useState(saved.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ValidationProgress | null>(null);
  const [checking, setChecking] = useState(false);
  const [waitedS, setWaitedS] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (saved.length > 0) return;
    let cancelled = false;
    void suggestForProduct(productId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCandidates(
        result.suggestions.map((s) => ({
          name: s.name,
          reason: s.reason,
          strictness: s.promotionStrictness,
        })),
      );
      setSelected(new Set(result.suggestions.slice(0, preselected).map((s) => s.name)));
    });
    return () => {
      cancelled = true;
    };
  }, [productId, saved.length]);

  useEffect(() => {
    if (!checking) return;
    const timer = setInterval(() => {
      setWaitedS((seconds) => seconds + 2);
      void checkProgress().then((current) => {
        setProgress(current);
        if (current?.done) {
          setChecking(false);
          // Missing subreddits are deselected automatically.
          setSelected((previous) => {
            const next = new Set(previous);
            for (const result of current.results)
              if (result.status === 'gone') next.delete(result.name);
            return next;
          });
        }
      });
    }, 2_000);
    return () => {
      clearInterval(timer);
    };
  }, [checking]);

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
      .replace(/^\/?r\//i, '')
      .toLowerCase();
    if (!/^[a-z0-9_]{2,21}$/.test(name)) {
      setError('Subreddit names use letters, digits and underscores.');
      return;
    }
    setError(null);
    setCandidates((list) =>
      list.some((c) => c.name === name)
        ? list
        : [...list, { name, reason: 'Added by you', strictness: 'unknown' }],
    );
    toggle(name, true);
    setCustom('');
  }

  function check() {
    startTransition(async () => {
      const result = await checkSubreddits([...selected]);
      if (!result.ok) {
        setError(result.error ?? 'Could not start the check.');
        return;
      }
      setProgress(null);
      setWaitedS(0);
      setChecking(true);
    });
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

  const resultFor = (name: string) => progress?.results.find((result) => result.name === name);

  return (
    <section aria-labelledby="step-subreddits" className="flex flex-col gap-4">
      <div>
        <h2 id="step-subreddits" className="text-sm font-semibold">
          Where do your customers ask questions?
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The best matches are ticked. Untick any that look wrong or add your own; {minSelected} to{' '}
          {maxSelected} work best.
        </p>
      </div>
      {loading ? <Banner>Suggesting subreddits…</Banner> : null}
      {candidates.length > 0 ? (
        <Card>
          <ul className="divide-y divide-border">
            {candidates.map((candidate) => {
              const result = resultFor(candidate.name);
              return (
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
                  <span className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
                    {result?.status === 'ok' ? (
                      <span className="flex items-center gap-1 text-brand-subtle-foreground">
                        <CircleCheck className="size-3.5" aria-hidden /> {result.postsPerDay ?? 0}{' '}
                        posts a day
                      </span>
                    ) : result?.status === 'gone' ? (
                      <span className="flex items-center gap-1 text-danger-foreground">
                        <CircleX className="size-3.5" aria-hidden /> Not found
                      </span>
                    ) : result?.status === 'unavailable' ? (
                      <span className="flex items-center gap-1 text-warning-foreground">
                        <CircleAlert className="size-3.5" aria-hidden /> Not checked yet
                      </span>
                    ) : checking && selected.has(candidate.name) ? (
                      <LoaderCircle className="size-3.5 animate-spin" aria-label="Checking" />
                    ) : null}
                  </span>
                </li>
              );
            })}
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
      {checking && waitedS >= 20 && (progress?.results.length ?? 0) === 0 ? (
        <Banner tone="warning">
          Waiting for the worker to pick this up. It runs alongside the dashboard when you start
          with pnpm dev, pnpm start or Docker.
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              router.push(stepHref('scan'));
            }}
          >
            Skip for now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={check}
            disabled={pending || checking || selected.size === 0}
          >
            {checking ? 'Checking…' : 'Check these exist'}
          </Button>
        </div>
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
