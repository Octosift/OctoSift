'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ExtractedProfile } from '@/core/ai/schemas';
import { ProfileFields } from '../components/profile-fields';
import { Button } from '../components/ui/button';
import { Banner, Card, CardHeader } from '../components/ui/display';
import { Checkbox, Field, Input, Textarea } from '../components/ui/fields';
import {
  buildProfile,
  completeOnboarding,
  crawlSite,
  createProduct,
} from '../lib/actions/onboarding';
import { stepHref } from './steps';

type Phase = 'url' | 'working' | 'review';

export function StepProduct({
  existing,
  demo,
  afterCreate = 'onboarding',
}: {
  existing: { id: string; name: string; url: string } | null;
  demo: boolean;
  /** Where to go once the product is saved: the next onboarding step, or its subreddits. */
  afterCreate?: 'onboarding' | 'subreddits';
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('url');
  const [url, setUrl] = useState(demo ? 'https://acme-invoices.example' : '');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askDescription, setAskDescription] = useState(false);
  const [description, setDescription] = useState('');
  const [profile, setProfile] = useState<ExtractedProfile | null>(null);
  const [answers, setAnswers] = useState({
    bestCustomer: '',
    misconceptions: '',
    neverReplyTo: '',
    includeLinks: true,
    redditUsername: '',
  });
  const [openAnswers, setOpenAnswers] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  if (existing && phase === 'url' && !profile) {
    return (
      <section aria-labelledby="step-product-saved" className="flex flex-col gap-4">
        <div>
          <h2 id="step-product-saved" className="text-xl font-semibold tracking-tight">
            Your product
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The profile is saved. Edit it any time on the{' '}
            <Link href="/product" className="text-foreground underline underline-offset-2">
              Product page
            </Link>
            .
          </p>
        </div>
        <Card>
          <CardHeader title={existing.name} description={existing.url} />
        </Card>
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              router.push(stepHref('subreddits'));
            }}
          >
            Continue
          </Button>
        </div>
      </section>
    );
  }

  function analyse(useDescription: boolean) {
    setError(null);
    setPhase('working');
    startTransition(async () => {
      let pages: { url: string; title: string; text: string }[] = [];
      if (!useDescription) {
        setStatus('Reading your website…');
        const crawl = await crawlSite(url);
        if (!crawl.ok) {
          setError(crawl.message);
          setAskDescription(crawl.askForDescription);
          setPhase('url');
          return;
        }
        pages = crawl.pages;
        // Show the address as it was read, for example with https:// added.
        setUrl(crawl.url);
        setStatus(
          `Read ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}. Building the profile…`,
        );
      } else {
        setStatus('Building the profile from your description…');
      }
      const result = await buildProfile({
        url,
        pages,
        description: useDescription ? description : null,
      });
      if (!result.ok) {
        setError(result.message);
        setPhase('url');
        return;
      }
      setProfile(result.profile);
      setPhase('review');
    });
  }

  function save() {
    if (!profile) return;
    startTransition(async () => {
      const result = await createProduct({
        url,
        profile,
        answers: {
          ...answers,
          openAnswers: profile.open_questions.map((question) => ({
            question,
            answer: openAnswers[question] ?? '',
          })),
        },
      });
      if (result.ok) {
        router.push(
          afterCreate === 'onboarding'
            ? stepHref('subreddits')
            : `/subreddits?product=${encodeURIComponent(result.productId)}`,
        );
        router.refresh();
      } else {
        setFieldErrors(result.errors);
      }
    });
  }

  if (phase !== 'review' || !profile) {
    return (
      <section aria-labelledby="step-product" className="flex flex-col gap-4">
        <div>
          <h2 id="step-product" className="text-xl font-semibold tracking-tight">
            What did you build?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste your website. We read a few of its pages and draft a profile you can edit.
          </p>
        </div>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            analyse(false);
          }}
        >
          <Field label="Product website" htmlFor="product-url" className="flex-1">
            <Input
              id="product-url"
              type="text"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              required
              placeholder="yourproduct.com"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
              }}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Working…' : 'Read my site'}
          </Button>
        </form>
        {phase === 'working' && status ? <Banner>{status}</Banner> : null}
        {error ? (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        ) : null}
        {afterCreate === 'onboarding' && phase === 'url' ? (
          <div className="flex justify-start">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  await completeOnboarding();
                  router.push('/');
                });
              }}
            >
              Skip for now
            </Button>
          </div>
        ) : null}
        {askDescription ? (
          <div className="flex flex-col gap-2">
            <Field
              label="Describe your product instead"
              htmlFor="product-description"
              hint="What it does, who it is for, what it costs, and what it does not do."
            >
              <Textarea
                id="product-description"
                rows={6}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                }}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  analyse(true);
                }}
                disabled={pending || description.trim().length < 20}
              >
                Build the profile from this
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  const update = (changes: Partial<ExtractedProfile>) => {
    setProfile({ ...profile, ...changes });
  };

  return (
    <section aria-labelledby="step-review" className="flex flex-col gap-4">
      <div>
        <h2 id="step-review" className="text-xl font-semibold tracking-tight">
          Check the profile
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Drafted from your site. Fix anything that is wrong, then continue.
        </p>
      </div>
      <Card>
        <ProfileFields
          profile={profile}
          onChange={update}
          errors={{
            name: fieldErrors['profile.name'],
            one_liner: fieldErrors['profile.one_liner'],
          }}
        />
      </Card>

      <details className="group rounded-lg border border-border bg-surface">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">
          A few optional questions
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Answers make leads more precise.
          </span>
        </summary>
        <div className="grid gap-4 border-t border-border px-4 py-4">
          <Field label="Who is your best customer? Describe one." htmlFor="answer-best">
            <Textarea
              id="answer-best"
              rows={2}
              value={answers.bestCustomer}
              onChange={(event) => {
                setAnswers({ ...answers, bestCustomer: event.target.value });
              }}
            />
          </Field>
          <Field
            label="What do people often assume your product does that it does not?"
            htmlFor="answer-assume"
          >
            <Textarea
              id="answer-assume"
              rows={2}
              value={answers.misconceptions}
              onChange={(event) => {
                setAnswers({ ...answers, misconceptions: event.target.value });
              }}
            />
          </Field>
          <Field label="Which problems should we never reply to?" htmlFor="answer-never">
            <Textarea
              id="answer-never"
              rows={2}
              value={answers.neverReplyTo}
              onChange={(event) => {
                setAnswers({ ...answers, neverReplyTo: event.target.value });
              }}
            />
          </Field>
          {profile.open_questions.map((question, index) => (
            <Field key={question} label={question} htmlFor={`answer-open-${index}`}>
              <Textarea
                id={`answer-open-${index}`}
                rows={2}
                value={openAnswers[question] ?? ''}
                onChange={(event) => {
                  setOpenAnswers({ ...openAnswers, [question]: event.target.value });
                }}
              />
            </Field>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={answers.includeLinks}
              onChange={(event) => {
                setAnswers({ ...answers, includeLinks: event.target.checked });
              }}
            />
            Include a link to the product when a subreddit allows links
          </label>
          <Field
            label="Your Reddit username"
            htmlFor="answer-username"
            hint="Only used to skip your own posts."
            error={fieldErrors['answers.redditUsername']}
          >
            <Input
              id="answer-username"
              placeholder="without u/"
              value={answers.redditUsername}
              onChange={(event) => {
                setAnswers({ ...answers, redditUsername: event.target.value });
              }}
            />
          </Field>
        </div>
      </details>
      {Object.keys(fieldErrors).length > 0 ? (
        <Banner tone="danger" role="alert">
          Some fields need attention: {Object.values(fieldErrors).join(' ')}
        </Banner>
      ) : null}
      <div className="flex justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setPhase('url');
          }}
        >
          Back
        </Button>
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save and continue'}
        </Button>
      </div>
    </section>
  );
}
