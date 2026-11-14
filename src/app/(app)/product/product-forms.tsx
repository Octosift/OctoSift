'use client';

import { useState, useTransition } from 'react';
import type { ProductProfile } from '@/core/profile/types';
import { ProfileFields, type EditableProfile } from '../../components/profile-fields';
import { Banner, Card, CardHeader } from '../../components/ui/display';
import { Checkbox, Field, Input, Select, Textarea } from '../../components/ui/fields';
import { saveProfile, saveReplySettings, type ProductResult } from '../../lib/actions/product';
import { SaveBar } from '../settings/save-bar';

export function useSave() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const save = (action: () => Promise<ProductResult>) => {
    startTransition(async () => {
      const result = await action();
      setErrors(result.ok ? {} : result.errors);
      setSaved(result.ok);
    });
  };
  return {
    errors,
    saved,
    pending,
    save,
    touch: () => {
      setSaved(false);
    },
  };
}

type ProfileState = EditableProfile &
  Pick<
    ProductProfile,
    | 'url'
    | 'best_customer'
    | 'misconceptions'
    | 'never_reply_to'
    | 'include_links'
    | 'reddit_username'
  >;

export function ProfileForm({
  productId,
  profile,
}: {
  productId: string;
  profile: ProductProfile;
}) {
  const [state, setState] = useState<ProfileState>(profile);
  const form = useSave();
  const update = (changes: Partial<ProfileState>) => {
    setState((current) => ({ ...current, ...changes }));
    form.touch();
  };
  return (
    <Card id="profile">
      <CardHeader
        title="Profile"
        description="Every stage works from this text. The short version used by triage is rebuilt when you save."
      />
      <div className="flex flex-col gap-4 px-4 pt-4">
        <Field label="Website" htmlFor="profile-url" error={form.errors.url}>
          <Input
            id="profile-url"
            type="url"
            value={state.url}
            onChange={(event) => {
              update({ url: event.target.value });
            }}
          />
        </Field>
      </div>
      <ProfileFields
        profile={state}
        onChange={update}
        errors={{ name: form.errors.name, one_liner: form.errors.one_liner }}
      />
      <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
        <Field label="Best customer" htmlFor="profile-best">
          <Textarea
            id="profile-best"
            rows={2}
            value={state.best_customer}
            onChange={(event) => {
              update({ best_customer: event.target.value });
            }}
          />
        </Field>
        <Field label="What people wrongly assume it does" htmlFor="profile-misconceptions">
          <Textarea
            id="profile-misconceptions"
            rows={2}
            value={state.misconceptions}
            onChange={(event) => {
              update({ misconceptions: event.target.value });
            }}
          />
        </Field>
        <Field label="Never reply about" htmlFor="profile-never" className="sm:col-span-2">
          <Textarea
            id="profile-never"
            rows={2}
            value={state.never_reply_to}
            onChange={(event) => {
              update({ never_reply_to: event.target.value });
            }}
          />
        </Field>
      </div>
      {form.errors.form ? (
        <Banner tone="danger" className="mx-4 mb-3" role="alert">
          {form.errors.form}
        </Banner>
      ) : null}
      <SaveBar
        pending={form.pending}
        saved={form.saved}
        hasErrors={Object.keys(form.errors).length > 0}
        onSave={() => {
          form.save(() =>
            saveProfile({
              productId,
              profile: {
                ...state,
                reddit_username: state.reddit_username,
              },
            }),
          );
        }}
      />
    </Card>
  );
}

export function RepliesForm({
  productId,
  mode,
  includeLinks,
  dmDrafts,
  audience,
}: {
  productId: string;
  mode: 'helpful_only' | 'soft_mention' | 'direct';
  includeLinks: boolean;
  dmDrafts: boolean | null;
  audience: string;
}) {
  const [state, setState] = useState({
    mode,
    includeLinks,
    dm: dmDrafts === null ? 'auto' : dmDrafts ? 'on' : 'off',
  });
  const form = useSave();
  return (
    <Card id="replies">
      <CardHeader title="Replies" description="How drafts may talk about the product." />
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
        <Field
          label="Most promotional reply allowed"
          htmlFor="reply-mode"
          hint="Each lead still gets the gentlest mode that fits it; this is the upper limit."
        >
          <Select
            id="reply-mode"
            value={state.mode}
            onChange={(event) => {
              setState({ ...state, mode: event.target.value as typeof mode });
              form.touch();
            }}
          >
            <option value="direct">Direct recommendation when asked</option>
            <option value="soft_mention">At most a short mention</option>
            <option value="helpful_only">Never mention the product</option>
          </Select>
        </Field>
        <Field
          label="Private-message drafts"
          htmlFor="reply-dm"
          hint={`Only when the author invites messages. Automatic means ${audience === 'consumers' ? 'off' : 'on'} for this product.`}
        >
          <Select
            id="reply-dm"
            value={state.dm}
            onChange={(event) => {
              setState({ ...state, dm: event.target.value });
              form.touch();
            }}
          >
            <option value="auto">Automatic</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
          <Checkbox
            checked={state.includeLinks}
            onChange={(event) => {
              setState({ ...state, includeLinks: event.target.checked });
              form.touch();
            }}
          />
          Include a link to the product where the subreddit allows links
        </label>
      </div>
      <SaveBar
        pending={form.pending}
        saved={form.saved}
        hasErrors={Object.keys(form.errors).length > 0}
        onSave={() => {
          form.save(() =>
            saveReplySettings({
              productId,
              mode: state.mode,
              includeLinks: state.includeLinks,
              dmDrafts: state.dm === 'auto' ? null : state.dm === 'on',
            }),
          );
        }}
      />
    </Card>
  );
}
