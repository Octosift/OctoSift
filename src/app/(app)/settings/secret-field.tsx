'use client';

import { useState, useTransition } from 'react';
import type { SecretDescription } from '@/core/secrets/store';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/display';
import { Input } from '../../components/ui/fields';
import { removeSecret, saveSecret } from '../../lib/actions/settings';

/**
 * A write-only field. After saving, only a mask such as "sk-…a1b2" is ever
 * shown; the value itself never comes back from the server.
 */
export function SecretField({
  name,
  label,
  description,
  placeholder,
  type = 'password',
  onSaved,
  onRemoved,
}: {
  name: string;
  label: string;
  description: SecretDescription;
  placeholder?: string;
  /** "text" for values that are private but not secret-looking, such as a login. */
  type?: 'password' | 'url' | 'text';
  onSaved?: () => void;
  onRemoved?: () => void;
}) {
  const [editing, setEditing] = useState(!description.configured);
  const [value, setValue] = useState('');
  const [mask, setMask] = useState(description.mask);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `secret-${name}`;

  function save() {
    startTransition(async () => {
      const result = await saveSecret({ name, value });
      if (result.ok) {
        setMask(result.mask);
        setValue('');
        setEditing(false);
        setError(null);
        onSaved?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5" data-secret={name}>
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {description.source === 'environment' ? (
        <p className="flex items-center gap-2 text-[13px]">
          <code className="font-mono text-xs" data-testid={`${name}-mask`}>
            {description.mask}
          </code>
          <Badge tone="outline">Set by environment variable</Badge>
        </p>
      ) : editing ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Input
            id={id}
            type={type}
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <Button type="submit" disabled={pending || value.trim() === ''}>
            Save
          </Button>
          {mask ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          ) : null}
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <code id={id} className="font-mono text-xs" data-testid={`${name}-mask`}>
            {mask}
          </code>
          <Button
            size="sm"
            onClick={() => {
              setEditing(true);
            }}
          >
            Replace
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                await removeSecret({ name });
                setMask(null);
                setEditing(true);
                onRemoved?.();
              });
            }}
          >
            Remove
          </Button>
        </div>
      )}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
