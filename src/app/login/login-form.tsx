'use client';

import { useActionState } from 'react';
import { Button } from '../components/ui/button';
import { Field, Input } from '../components/ui/fields';
import { login, type LoginState } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null });
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Password" htmlFor="password" error={state.error ?? undefined}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? 'password-error' : undefined}
        />
      </Field>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
