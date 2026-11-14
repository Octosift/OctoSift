import { Button } from '../../components/ui/button';

export function SaveBar({
  pending,
  saved,
  hasErrors,
  onSave,
  label = 'Save',
}: {
  pending: boolean;
  saved: boolean;
  hasErrors: boolean;
  onSave: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
      <span role="status" className="text-xs text-muted-foreground">
        {hasErrors ? 'Fix the highlighted fields.' : saved ? 'Saved.' : ''}
      </span>
      <Button variant="primary" onClick={onSave} disabled={pending}>
        {pending ? 'Saving…' : label}
      </Button>
    </div>
  );
}
