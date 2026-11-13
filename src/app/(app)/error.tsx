'use client';

import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/display';

/** Shown when a screen fails to load; the rest of the app keeps working. */
export default function ScreenError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      title="This screen could not be loaded"
      action={
        <Button
          onClick={() => {
            reset();
          }}
        >
          Try again
        </Button>
      }
    >
      Something went wrong while reading the local database. If it keeps happening, check the
      terminal where the app is running for details.
    </EmptyState>
  );
}
