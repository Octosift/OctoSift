'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AUDIENCES, PRODUCT_TYPES, type ExtractedProfile } from '@/core/ai/schemas';
import { Button } from '../components/ui/button';
import { Banner, Card, CardHeader } from '../components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '../components/ui/fields';
import { buildProfile, crawlSite, createProduct } from '../lib/actions/onboarding';

type Phase = 'url' | 'working' | 'review';
type ListKey =
  | 'what_it_does'
  | 'who_it_is_for'
  | 'problems_solved'
  | 'not_for'
  | 'buyer_phrases'
  | 'alternatives';

const LISTS: { key: ListKey; label: string; hint: string; wide?: boolean }[] = [
  { key: 'what_it_does', label: 'What it does', hint: 'One per line.' },
  { key: 'who_it_is_for', label: 'Who it is for', hint: 'One audience per line.' },
  {
    key: 'problems_solved',
    label: 'Problems it solves',
    hint: 'In the words a customer would use.',
  },
  {
    key: 'buyer_phrases',
    label: 'Phrases people with the problem write',
    hint: 'For example "client is late paying".',
  },
  {
    key: 'not_for',
    label: 'What it does not do',
    hint: 'The most useful field for precision: things people might expect but the product does not do, and audiences it does not serve.',
    wide: true,
  },
  {
    key: 'alternatives',
    label: 'What people use instead',
    hint: 'Kinds of tools or approaches, one per line.',
    wide: true,
  },
];

const toLines = (items: string[]) => items.join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export function StepProduct({
  existing,
  demo,
}: {
  existing: { id: string; name: string; url: string } | null;
  demo: boolean;
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
      <Card>
        <CardHeader title={existing.name} description={existing.url} />
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-[13px] text-muted-foreground">
            The profile is saved. You can edit it later on the Product page.
          </p>
          <Button
            variant="primary"
            onClick={() => {
              router.push('/onboarding?step=3');
            }}
          >
            Continue
          </Button>
        </div>
      </Card>
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
        router.push('/onboarding?step=3');
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
          <h2 id="step-product" className="text-sm font-semibold">
            What did you build?
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            We read your homepage and a few pages it links to (pricing, features, about, docs, FAQ)
            and draft a profile you can edit.
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
              type="url"
              required
              placeholder="https://"
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
        <h2 id="step-review" className="text-sm font-semibold">
          Check the profile
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Every stage works from this text, so correct anything that is wrong or missing.
        </p>
      </div>
      <Card>
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="profile-name" error={fieldErrors['profile.name']}>
            <Input
              id="profile-name"
              value={profile.name}
              onChange={(event) => {
                update({ name: event.target.value });
              }}
            />
          </Field>
          <Field label="Pricing" htmlFor="profile-pricing">
            <Input
              id="profile-pricing"
              value={profile.pricing}
              onChange={(event) => {
                update({ pricing: event.target.value });
              }}
            />
          </Field>
          <Field
            label="In one line"
            htmlFor="profile-one-liner"
            className="sm:col-span-2"
            error={fieldErrors['profile.one_liner']}
          >
            <Input
              id="profile-one-liner"
              value={profile.one_liner}
              onChange={(event) => {
                update({ one_liner: event.target.value });
              }}
            />
          </Field>
          <Field label="Type" htmlFor="profile-type">
            <Select
              id="profile-type"
              value={profile.product_type}
              onChange={(event) => {
                update({ product_type: event.target.value as ExtractedProfile['product_type'] });
              }}
            >
              {PRODUCT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Audience" htmlFor="profile-audience">
            <Select
              id="profile-audience"
              value={profile.audience}
              onChange={(event) => {
                update({ audience: event.target.value as ExtractedProfile['audience'] });
              }}
            >
              {AUDIENCES.map((audience) => (
                <option key={audience} value={audience}>
                  {audience}
                </option>
              ))}
            </Select>
          </Field>
          {LISTS.map(({ key, label, hint, wide }) => (
            <Field
              key={key}
              label={label}
              htmlFor={`profile-${key}`}
              hint={hint}
              className={wide ? 'sm:col-span-2' : undefined}
            >
              <Textarea
                id={`profile-${key}`}
                rows={4}
                value={toLines(profile[key])}
                onChange={(event) => {
                  update({ [key]: fromLines(event.target.value) });
                }}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="A few questions"
          description="All optional. Your answers make leads more precise."
        />
        <div className="grid gap-4 px-4 py-4">
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
          <label className="flex items-center gap-2 text-[13px]">
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
      </Card>
      {Object.keys(fieldErrors).length > 0 ? (
        <Banner tone="danger" role="alert">
          Some fields need attention: {Object.values(fieldErrors).join(' ')}
        </Banner>
      ) : null}
      <div className="flex justify-between gap-3">
        <Button
          variant="ghost"
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
