/**
 * Optional notifications for strong leads, posted to a webhook URL in a
 * Slack-style or Discord-style format. One retry, then the notification is
 * dropped: a missed ping must never hold up a scan.
 *
 * Titles and reasons come from strangers on Reddit, so the payloads escape
 * Slack's control characters and disable Discord mentions; a post titled
 * "@everyone" must not ping a whole channel.
 */
import { CONFIG } from '../config';

export type WebhookFormat = 'slack' | 'discord';

export interface WebhookLead {
  leadId: string;
  productName: string;
  title: string;
  subreddit: string;
  score: number;
  reason: string;
  /** The Reddit post. */
  url: string;
}

function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A URL inside Slack's <url|label> syntax: a "|" would end the address early. */
function slackLink(url: string, label: string): string {
  return `<${escapeSlack(url).replace(/\|/g, '%7C')}|${label}>`;
}

export function leadLink(dashboardUrl: string, leadId: string): string {
  return `${dashboardUrl.replace(/\/+$/, '')}/inbox?lead=${encodeURIComponent(leadId)}`;
}

export function webhookPayload(
  format: WebhookFormat,
  lead: WebhookLead,
  dashboardUrl: string,
): Record<string, unknown> {
  const link = leadLink(dashboardUrl, lead.leadId);
  const heading = `New lead for ${lead.productName} (score ${lead.score}) in r/${lead.subreddit}`;
  if (format === 'slack') {
    return {
      text: [
        `*${escapeSlack(heading)}*`,
        escapeSlack(lead.title),
        `_${escapeSlack(lead.reason)}_`,
        `${slackLink(link, 'Open in dashboard')} · ${slackLink(lead.url, 'View on Reddit')}`,
      ].join('\n'),
    };
  }
  return {
    content: heading,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: lead.title.slice(0, 256),
        url: link,
        description: lead.reason.slice(0, 2_000),
        fields: [
          { name: 'Score', value: String(lead.score), inline: true },
          { name: 'Subreddit', value: `r/${lead.subreddit}`, inline: true },
          { name: 'Post', value: lead.url },
        ],
      },
    ],
  };
}

export type WebhookResult = { ok: true } | { ok: false; message: string };

export async function sendWebhook(options: {
  url: string;
  format: WebhookFormat;
  lead: WebhookLead;
  dashboardUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<WebhookResult> {
  const { fetchImpl = fetch } = options;
  const body = JSON.stringify(webhookPayload(options.format, options.lead, options.dashboardUrl));
  let message = 'not sent';
  for (let attempt = 1; attempt <= CONFIG.notify.maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(CONFIG.notify.timeoutMs),
      });
      if (response.ok) return { ok: true };
      message = `The webhook answered HTTP ${response.status}`;
      // Client errors will not fix themselves on a retry.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Network error';
    }
  }
  return { ok: false, message };
}
