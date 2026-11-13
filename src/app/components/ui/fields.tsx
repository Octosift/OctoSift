/** Form controls: labelled, keyboard reachable, with room for field-level errors. */
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './utils';

const control =
  'w-full rounded-md border border-input bg-surface px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground disabled:opacity-60 aria-invalid:border-danger-foreground';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-8', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-20 py-2 leading-5', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(control, 'h-8 pr-7', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-xs font-medium text-foreground', className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger-foreground" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn('size-3.5 rounded border-input accent-[var(--brand)]', className)}
      {...props}
    />
  );
}
