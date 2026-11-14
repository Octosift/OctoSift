'use client';

import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/display';
import { Checkbox, Field, Input, Textarea } from '../../components/ui/fields';
import { removeProduct, saveProductRules } from '../../lib/actions/product';
import { SaveBar } from '../settings/save-bar';
import { useSave } from './product-forms';

export function RulesForm({
  productId,
  thresholds,
  overridden,
  vetoPhrases,
}: {
  productId: string;
  thresholds: { show: number; draft: number; notify: number };
  overridden: boolean;
  vetoPhrases: string[];
}) {
  const [own, setOwn] = useState(overridden);
  const [values, setValues] = useState({
    show: String(thresholds.show),
    draft: String(thresholds.draft),
    notify: String(thresholds.notify),
  });
  const [phrases, setPhrases] = useState(vetoPhrases.join('\n'));
  const form = useSave();
  const number = (key: keyof typeof values, label: string) => (
    <Field label={label} htmlFor={`threshold-${key}`}>
      <Input
        id={`threshold-${key}`}
        type="number"
        min="0"
        max="100"
        disabled={!own}
        value={values[key]}
        onChange={(event) => {
          setValues({ ...values, [key]: event.target.value });
          form.touch();
        }}
      />
    </Field>
  );
  return (
    <Card id="rules">
      <CardHeader title="Thresholds and veto phrases" />
      <div className="flex flex-col gap-4 px-4 py-4">
        <label className="flex items-center gap-2 text-[13px]">
          <Checkbox
            checked={own}
            onChange={(event) => {
              setOwn(event.target.checked);
              form.touch();
            }}
          />
          Use thresholds for this product instead of the ones in Settings
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          {number('show', 'Show in inbox from')}
          {number('draft', 'Draft replies from')}
          {number('notify', 'Notify from')}
        </div>
        {form.errors.thresholds ? (
          <p role="alert" className="text-xs text-danger-foreground">
            {form.errors.thresholds}
          </p>
        ) : null}
        <Field
          label="Veto phrases"
          htmlFor="veto-phrases"
          hint="One per line. A post containing any of them is never a lead, whatever its score."
          error={form.errors.vetoPhrases}
        >
          <Textarea
            id="veto-phrases"
            rows={4}
            value={phrases}
            onChange={(event) => {
              setPhrases(event.target.value);
              form.touch();
            }}
          />
        </Field>
      </div>
      <SaveBar
        pending={form.pending}
        saved={form.saved}
        hasErrors={Object.keys(form.errors).length > 0}
        onSave={() => {
          form.save(() =>
            saveProductRules({
              productId,
              thresholds: own
                ? {
                    show: Number(values.show),
                    draft: Number(values.draft),
                    notify: Number(values.notify),
                  }
                : null,
              vetoPhrases: phrases
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0),
            }),
          );
        }}
      />
    </Card>
  );
}

export function DeleteProductForm({ productId, name }: { productId: string; name: string }) {
  const [confirm, setConfirm] = useState('');
  const form = useSave();
  return (
    <Card id="delete">
      <CardHeader
        title="Delete this product"
        description="Removes the product with its leads, drafts and feedback. Posts and subreddits shared with other products are kept."
      />
      <form
        className="flex flex-wrap items-center gap-2 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.save(() => removeProduct({ productId, confirmName: confirm }));
        }}
      >
        <Input
          aria-label={`Type ${name} to confirm`}
          placeholder={name}
          className="max-w-60"
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value);
          }}
        />
        <Button type="submit" variant="danger" disabled={form.pending}>
          Delete product
        </Button>
        {form.errors.form ? (
          <p role="alert" className="w-full text-xs text-danger-foreground">
            {form.errors.form}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
