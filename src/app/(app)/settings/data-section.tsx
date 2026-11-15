'use client';

import { Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '../../components/ui/button';
import { Banner, Card, CardHeader } from '../../components/ui/display';
import { Input } from '../../components/ui/fields';
import { deleteEverything } from '../../lib/actions/settings';

export function DataSection() {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Card id="data">
      <CardHeader
        title="Your data"
        description="Everything is stored in one database file (SQLite) on the computer running the app."
      />
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            Download products, posts, leads, drafts, runs and settings as a JSON file. API keys,
            passwords and the Reddit cookie are left out.
          </p>
          <Button asChild>
            <a href="/api/export" download>
              Export JSON
            </a>
          </Button>
        </div>
        <Banner tone="danger" className="flex-col gap-2">
          <p className="font-medium">Delete all data</p>
          <p>
            Removes every product, post, lead, draft, run, setting and saved key. This cannot be
            undone. Type <strong>delete</strong> to confirm.
          </p>
          <form
            className="flex w-full flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await deleteEverything(confirm);
                setError(result.error);
              });
            }}
          >
            <Input
              aria-label="Type delete to confirm"
              className="max-w-40"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
              }}
            />
            <Button type="submit" variant="danger" disabled={pending}>
              <Trash2 aria-hidden /> Delete everything
            </Button>
          </form>
          {error ? <p role="alert">{error}</p> : null}
        </Banner>
      </div>
    </Card>
  );
}
