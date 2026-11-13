'use client';

import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/display';

export default function InboxError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      title="The inbox could not be loaded"
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
      Something went wrong while reading the database. If this keeps happening, check the terminal
      where the app is running for details.
    </EmptyState>
  );
}
