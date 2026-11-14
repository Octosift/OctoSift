'use client';

import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Checkbox, Field, Input } from '../../components/ui/fields';

export function ReplyConfirmDialog({
  open,
  onOpenChange,
  mentionsProduct,
  productName,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mentionsProduct: boolean;
  productName: string;
  onConfirm: (commentUrl: string, mentioned: boolean) => void;
  pending: boolean;
}) {
  const [commentUrl, setCommentUrl] = useState('');
  const [mentioned, setMentioned] = useState(mentionsProduct);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Did you post your reply?"
      description="The draft is on your clipboard and the thread is open in a new tab."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(commentUrl, mentioned);
        }}
      >
        <Field
          label="Link to your comment (optional)"
          htmlFor="comment-url"
          hint="Kept with the lead. With a Reddit account connected, the app checks an hour and a day later that others can still see your comment. Reply from a different account than the connected one, or the check cannot tell."
        >
          <Input
            id="comment-url"
            type="text"
            inputMode="url"
            spellCheck={false}
            placeholder="reddit.com/r/…/comments/…"
            value={commentUrl}
            onChange={(event) => {
              setCommentUrl(event.target.value);
            }}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={mentioned}
            onChange={(event) => {
              setMentioned(event.target.checked);
            }}
          />
          My reply mentions {productName}
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Not yet
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            Mark as replied
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const DISMISS_REASONS = ['Not a fit', 'Already answered', 'Not worth replying to'];

export function DismissDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Dismiss this lead"
      description="A short reason helps you review dismissed leads later."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(reason);
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {DISMISS_REASONS.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setReason(preset);
              }}
            >
              {preset}
            </Button>
          ))}
        </div>
        <Field label="Reason (optional)" htmlFor="dismiss-reason">
          <Input
            id="dismiss-reason"
            autoFocus
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            Dismiss
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
