'use client';

import { AUDIENCES, PRODUCT_TYPES, type ExtractedProfile } from '@/core/ai/schemas';
import { Field, Input, Select, Textarea } from './ui/fields';

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

export type EditableProfile = Omit<ExtractedProfile, 'open_questions'>;

/** The editable fields of a product profile, shared by onboarding and the Product screen. */
export function ProfileFields({
  profile,
  onChange,
  errors = {},
}: {
  profile: EditableProfile;
  onChange: (changes: Partial<EditableProfile>) => void;
  errors?: Partial<Record<keyof EditableProfile, string | undefined>>;
}) {
  const update = onChange;
  return (
    <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
      <Field label="Name" htmlFor="profile-name" error={errors.name}>
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
        error={errors.one_liner}
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
            update({ product_type: event.target.value as EditableProfile['product_type'] });
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
            update({ audience: event.target.value as EditableProfile['audience'] });
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
  );
}
