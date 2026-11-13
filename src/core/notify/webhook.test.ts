import { describe, expect, it } from 'vitest';
import { sendWebhook, webhookPayload, type WebhookLead } from './webhook';

const lead: WebhookLead = {
  leadId: 'lead-1',
  productName: 'Acme Invoices',
  title: 'Need invoicing <!channel> @everyone & more',
  subreddit: 'freelance_demo',
  score: 92,
  reason: 'Asks for an invoicing tool.',
  url: 'https://www.reddit.com/r/freelance_demo/comments/x/y/',
};

const DASHBOARD = 'http://127.0.0.1:3000/';

describe('webhookPayload', () => {
  it('builds a Slack message with escaped text and links', () => {
    const payload = webhookPayload('slack', lead, DASHBOARD);
    const text = String(payload.text);
    expect(text).toContain('score 92');
    expect(text).toContain('&lt;!channel&gt;');
    expect(text).not.toContain('<!channel>');
    expect(text).toContain('<http://127.0.0.1:3000/inbox?lead=lead-1|Open in dashboard>');
  });

  it('keeps link text intact when a URL contains Slack control characters', () => {
    const odd = { ...lead, url: 'https://www.reddit.com/r/x/comments/a|Click here>/<b>' };
    const text = String(webhookPayload('slack', odd, DASHBOARD).text);
    expect(text).toContain(
      '<https://www.reddit.com/r/x/comments/a%7CClick here&gt;/&lt;b&gt;|View on Reddit>',
    );
  });

  it('builds a Discord message that cannot mention anyone', () => {
    const payload = webhookPayload('discord', lead, DASHBOARD);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds).toEqual([
      expect.objectContaining({
        title: lead.title,
        url: 'http://127.0.0.1:3000/inbox?lead=lead-1',
        description: lead.reason,
      }),
    ]);
  });
});

describe('sendWebhook', () => {
  function server(statuses: (number | Error)[]) {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : '' });
      const next = statuses.shift() ?? 200;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(new Response('', { status: next }));
    };
    return { calls, fetchImpl };
  }

  const send = (fetchImpl: typeof fetch) =>
    sendWebhook({
      url: 'https://hooks.example.com/abc',
      format: 'slack',
      lead,
      dashboardUrl: DASHBOARD,
      fetchImpl,
    });

  it('posts the payload as JSON', async () => {
    const { calls, fetchImpl } = server([200]);
    expect(await send(fetchImpl)).toEqual({ ok: true });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toHaveProperty('text');
  });

  it('retries once after a failure and then succeeds', async () => {
    const { calls, fetchImpl } = server([new TypeError('fetch failed'), 200]);
    expect(await send(fetchImpl)).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('drops the notification after the retry fails', async () => {
    const { calls, fetchImpl } = server([503, 503, 200]);
    expect(await send(fetchImpl)).toEqual({ ok: false, message: 'The webhook answered HTTP 503' });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a request the webhook rejected', async () => {
    const { calls, fetchImpl } = server([404]);
    expect(await send(fetchImpl)).toEqual({ ok: false, message: 'The webhook answered HTTP 404' });
    expect(calls).toHaveLength(1);
  });
});
