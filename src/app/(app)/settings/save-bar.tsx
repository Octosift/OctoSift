import { Button } from '../../components/ui/button';
import { cn } from '../../components/ui/utils';

export function SaveBar({
  pending,
  saved,
  hasErrors,
  onSave,
  label = 'Save',
  sticky = false,
}: {
  pending: boolean;
  saved: boolean;
  hasErrors: boolean;
  onSave: () => void;
  label?: string;
  /** Long forms keep the button in view while you scroll through them. */
  sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-3 border-t border-border px-4 py-3',
        sticky && 'sticky bottom-0 z-10 rounded-b-xl bg-surface/95 backdrop-blur',
      )}
    >
      <span role="status" className="text-xs text-muted-foreground">
        {hasErrors ? 'Fix the highlighted fields.' : saved ? 'Saved.' : ''}
      </span>
      <Button variant="primary" onClick={onSave} disabled={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    </div>
  );
}
