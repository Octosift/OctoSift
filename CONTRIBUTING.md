# Contributing

Thank you for helping. Bug reports, ideas, documentation fixes and code are all welcome.
Everyone taking part in the project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Found a bug?** Open an issue with the steps to reproduce it. The bug report form asks for
  the details we usually need.
- **Want to add a feature?** Open an issue first and describe the problem it solves, so we can
  agree on the approach before you spend time on it.
- **Found a security problem?** Do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Set up

You need pnpm and Node.js 24 (22.12+ and 26 also work; `.nvmrc` selects 24).

```sh
pnpm install
pnpm demo        # the dashboard on http://127.0.0.1:3005 with synthetic data
```

Demo mode needs no key and makes no network requests: Reddit posts come from fixtures and a
simulated provider stands in for the AI. Most changes can be built and checked entirely in
demo mode. For real data, see the quick start in the [README](README.md#quick-start).

## Where things live

| Path         | What it holds                                                               |
| ------------ | --------------------------------------------------------------------------- |
| `src/core`   | The library: Reddit sources, AI providers and prompts, the pipeline, guards |
| `src/app`    | The Next.js dashboard                                                       |
| `src/worker` | The background process that runs scheduled scans                            |
| `src/cli`    | The `pnpm scan`, `pnpm eval` and `pnpm cli` commands                        |
| `fixtures`   | Synthetic posts, products and provider responses used by tests and the demo |
| `tests/e2e`  | Playwright smoke tests                                                      |
| `docs`       | Architecture, pipeline, sources and privacy notes                           |

[docs/architecture.md](docs/architecture.md) explains how the pieces fit together, and
[docs/adding-a-source.md](docs/adding-a-source.md) walks through adding a new source.

## Check your change

```sh
pnpm check       # lint, formatting, typecheck, unit tests and the leak check
pnpm test:e2e    # Playwright smoke tests in demo mode (downloads Chromium once)
```

CI runs the same checks on every pull request.

## Ground rules

- **Tests make no network requests.** Use the fixtures and the fake clock and providers in
  `src/core/testing`.
- **Network access stays in a few modules.** A lint rule forbids `fetch` everywhere except the
  modules listed in `eslint.config.js`. If you need a new one, explain why in the pull request.
- **No telemetry, analytics or new outside services.** The app talks only to Reddit (to read),
  the user's AI provider and integrations the user turns on.
- **Synthetic data only.** Never commit real Reddit posts, usernames, keys or cookies. The leak
  check catches the common cases, and reviewers check the rest.
- **Posting is out of scope here.** Changes that post, vote or send messages on a user's
  behalf, or that raise the Reddit request limits, will not be accepted. See
  [Responsible use](README.md#responsible-use).
- **Plain words in the interface.** Write labels and messages the way you would explain them
  to a founder who is not technical.
- **AI help is fine, unreviewed AI output is not.** You may use AI tools, but you must have
  read, understood and tested every line you send, and be able to explain it in review. Pull
  requests and issues that look generated without that care are closed without review.

## Pull requests

- Keep each pull request to one change, with tests for new behaviour.
- Use [Conventional Commits](https://www.conventionalcommits.org) with a scope, for example
  `fix(inbox): keep the selected lead after a rescan`.
- Describe what changed and why, and add a screenshot for visible changes. `pnpm screenshots`
  retakes the README images from a running demo if your change affects them.

## License

By contributing, you agree that your contribution is licensed under the project's
[GNU Affero General Public License v3.0](LICENSE). The license does not cover the Octosift
name and logo; see [TRADEMARKS.md](TRADEMARKS.md).
