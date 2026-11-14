'use client';

import { LogIn, ClipboardPaste, Unplug } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Badge, Banner, Card, CardHeader } from '../../components/ui/display';
import { Input, Textarea } from '../../components/ui/fields';
import {
  browserSignInStatus,
  connectWithCookie,
  disconnectReddit,
  setRedditAccountName,
  startBrowserSignIn,
} from '../../lib/actions/reddit-account';
import type { SettingsData } from '../../lib/data/settings';
import { formatAgo } from '../../lib/format';

type Account = SettingsData['account'];

function StatusLine({ account, now }: { account: Account; now: number }) {
  if (account.status === 'not_connected') {
    return <Badge tone="outline">Not connected</Badge>;
  }
  const name = account.username ? `u/${account.username}` : 'an account';
  if (account.status === 'needs_reauth') {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone="danger">Needs reconnecting</Badge>
        <span className="text-xs text-muted-foreground">
          {name}: {account.reason} ({formatAgo(account.since, now)})
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="brand">Connected</Badge>
      <span className="text-xs text-muted-foreground">
        {account.username ? `as u/${account.username}` : 'account name unknown'}
        {account.cookieMask ? ` · cookie ${account.cookieMask}` : ''}
      </span>
    </span>
  );
}

function PasteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Paste a Reddit session cookie"
      className="max-w-lg"
      description="For when a browser window cannot be opened here, for example in Docker."
    >
      <form
        className="mt-3 flex flex-col gap-3 text-[13px]"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await connectWithCookie({ cookie: value });
            if (result.ok) {
              setValue('');
              setError(null);
              onOpenChange(false);
              router.refresh();
            } else {
              setError(result.error);
            }
          });
        }}
      >
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Open reddit.com in your browser, signed in to the account you want to use.</li>
          <li>Open the developer tools, go to the Network tab and reload the page.</li>
          <li>
            Click any request to www.reddit.com and copy the value of the <code>cookie</code>{' '}
            request header.
          </li>
          <li>Paste it below. It is checked with one request, then stored encrypted.</li>
        </ol>
        <label htmlFor="reddit-cookie" className="sr-only">
          Cookie header
        </label>
        <Textarea
          id="reddit-cookie"
          rows={5}
          value={value}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          placeholder="reddit_session=…; token_v2=…"
          onChange={(event) => {
            setValue(event.target.value);
          }}
          aria-invalid={error ? true : undefined}
        />
        {error ? (
          <p role="alert" className="text-xs text-danger-foreground">
            {error}
          </p>
        ) : null}
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
          <Button type="submit" variant="primary" disabled={pending || value.trim() === ''}>
            {pending ? 'Checking…' : 'Check and save'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function NameForm() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await setRedditAccountName({ username: value });
          setError(result.ok ? null : result.error);
          if (result.ok) router.refresh();
        });
      }}
    >
      <label htmlFor="reddit-account-name" className="text-xs text-muted-foreground">
        Reddit did not share the account name. Type it so the dashboard can show it.
      </label>
      <div className="flex max-w-sm gap-2">
        <Input
          id="reddit-account-name"
          placeholder="without u/"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        <Button type="submit" size="sm" disabled={pending || value.trim() === ''}>
          Save
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger-foreground">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export function RedditAccountCard({
  account,
  now,
  demo,
}: {
  account: Account;
  now: number;
  demo: boolean;
}) {
  const router = useRouter();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // While the sign-in window is open, check every second whether it finished.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void browserSignInStatus().then((state) => {
        if (state.status === 'waiting') return;
        setWaiting(false);
        if (state.status === 'connected') {
          setMessage({ tone: 'info', text: 'Reddit account connected.' });
          router.refresh();
        } else if (state.status === 'failed') {
          setMessage({ tone: 'danger', text: state.message });
        }
      });
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [waiting, router]);

  const connected = account.status !== 'not_connected';
  return (
    <Card id="reddit">
      <CardHeader
        title="Reddit account"
        description="The default way of reading Reddit: listings read with an account you connect."
      />
      <div className="flex flex-col gap-3 px-4 py-4 text-[13px]">
        <div className="flex">
          <StatusLine account={account} now={now} />
        </div>
        <p className="text-xs text-muted-foreground">
          Use a separate Reddit account for this, not your main one. The app only reads public
          subreddit listings, slowly (at most {account.perHour} requests an hour), and never posts,
          votes or sends messages. Automated reading can still get an account limited, which is why
          a separate account is safer. The session cookie is stored encrypted and only ever sent to
          www.reddit.com.
        </p>
        {account.status === 'connected' && account.username === null ? <NameForm /> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={connected ? 'outline' : 'brand'}
            disabled={demo || pending || waiting || account.inContainer}
            onClick={() => {
              setMessage(null);
              startTransition(async () => {
                const result = await startBrowserSignIn();
                if (result.ok) {
                  setWaiting(true);
                  setMessage({
                    tone: 'info',
                    text: 'A browser window opened on Reddit. Sign in there; it closes by itself.',
                  });
                } else {
                  setMessage({ tone: 'danger', text: result.error });
                }
              });
            }}
          >
            <LogIn aria-hidden />
            {waiting
              ? 'Waiting for sign-in…'
              : connected
                ? 'Reconnect with a browser window'
                : 'Sign in with a browser window'}
          </Button>
          <Button
            variant="outline"
            disabled={demo || waiting}
            onClick={() => {
              setPasteOpen(true);
            }}
          >
            <ClipboardPaste aria-hidden />
            Paste cookie
          </Button>
          {connected ? (
            <Button
              variant="ghost"
              disabled={pending || waiting}
              onClick={() => {
                startTransition(async () => {
                  await disconnectReddit();
                  setMessage({
                    tone: 'info',
                    text: 'Disconnected. The stored cookie was deleted.',
                  });
                  router.refresh();
                });
              }}
            >
              <Unplug aria-hidden />
              Disconnect
            </Button>
          ) : null}
        </div>
        {demo ? (
          <p className="text-xs text-muted-foreground">
            Demo mode reads synthetic posts, so connecting an account is turned off here.
          </p>
        ) : null}
        {account.inContainer ? (
          <p className="text-xs text-muted-foreground">
            Signing in with a browser window needs the app to run on your own computer; in Docker,
            paste the cookie instead.
          </p>
        ) : null}
        {message ? (
          <Banner
            tone={message.tone === 'danger' ? 'danger' : 'info'}
            role={message.tone === 'danger' ? 'alert' : 'status'}
          >
            {message.text}
          </Banner>
        ) : null}
      </div>
      <PasteDialog open={pasteOpen} onOpenChange={setPasteOpen} />
    </Card>
  );
}
