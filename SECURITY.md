# Security policy

Octosift stores AI provider keys and a Reddit session on the machine that runs it, so we
take security reports seriously and are grateful for them.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately through
GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**.

Include what you can of:

- what an attacker could do, and under which setup (local, Docker, exposed dashboard);
- the steps to reproduce it, or a proof of concept;
- the version or commit you tested.

We aim to acknowledge a report within a few days and to agree on a fix and a disclosure date
with you. We will credit you in the release notes unless you prefer otherwise.

## Supported versions

Octosift is young and ships from the `main` branch. Security fixes go into the latest
release only, so please update before reporting.

## How Octosift protects your data

These are the design guarantees a report would most likely break:

- **Local first.** Everything is stored in a SQLite file on your machine. There is no
  telemetry, analytics or phone-home. The app talks only to Reddit (to read), the AI provider
  you configure and the optional integrations you turn on.
- **Encrypted secrets.** API keys and the Reddit session are encrypted with AES-256-GCM. The
  key comes from `APP_SECRET`, or from a random key file created with owner-only permissions.
  Secrets are never shown again in the dashboard and never included in exports.
- **Closed by default.** The dashboard listens on 127.0.0.1. `APP_PASSWORD` puts a password in
  front of it before you expose it to a network.
- **Untrusted input stays data.** Reddit posts and fetched web pages are marked as untrusted in
  every prompt, so text in them cannot give the models instructions.
- **Careful fetching.** Reading your product's website refuses private and local network
  addresses, limits redirects and stops after a fixed size.
- **Read only on Reddit.** The connected account is used to read, never to post, vote or send
  messages.

## Out of scope

- Reddit limiting or suspending an account that is used with the app. See
  [Responsible use](README.md#responsible-use).
- Problems that need an attacker who already controls your machine or your `.env` file.
- Costs from AI providers, which are bounded by the budget caps you set.
