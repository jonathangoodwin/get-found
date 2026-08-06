# get-found

[![CI](https://github.com/jonathangoodwin/get-found/actions/workflows/ci.yml/badge.svg)](https://github.com/jonathangoodwin/get-found/actions/workflows/ci.yml)

Agentic SEO in a box. Point it at your domain and a few competitors; it
crawls both, pulls your Google Search Console data, and produces a ranked
report of:

- **New content opportunities** — topics your competitors cover that you don't.
- **Quick wins** — your own pages ranking positions 11-30 ("striking distance")
  that need improvement rather than a new page from scratch.

## Design

The engine is a deterministic spine with an optional AI layer on top, so the
core tool runs with zero API keys:

```
collectors/   crawl sitemaps + Search Console — no LLM involved
gap-engine/   pure functions: topic extraction, gap scoring, striking distance
history/      snapshot storage (I/O) + pure run-to-run diffing
report/       markdown report rendering
ai/           typed BriefDrafter interface; rule-based fallback ships today,
              an LLM-backed drafter can implement the same interface later
```

Every AI-drafted output is labeled `source: "ai-drafted"` and is meant to be
reviewed by a human before it reaches a writer — see the Google Search
Quality Rater Guidelines' treatment of unreviewed AI content as a spam risk.

## Quickstart

```bash
npm install
npm run dev -- run --site example.com --competitors competitor1.com,competitor2.com
```

This crawls both domains' sitemaps (respecting `robots.txt`) and prints a
markdown report of content-gap opportunities to stdout.

### Adding Search Console data (optional, free)

Striking-distance analysis needs your own Search Console data:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an OAuth client ID of type "Web application" with
   `http://localhost:8080/oauth2callback` as an authorized redirect URI, and
   enable the **Google Search Console API** for the project.
2. Copy `.env.example` to `.env` and fill in `GSC_CLIENT_ID` /
   `GSC_CLIENT_SECRET` from that client.
3. Run `npm run gsc:auth` — it prints a Google consent URL, opens a local
   server to catch the redirect, and prints a `GSC_REFRESH_TOKEN` to add to
   `.env`. One-time setup per Search Console property/account.
4. Add `--gsc-site-url "sc-domain:example.com"` (or the exact property URL)
   to the `run` command.

### Adding AI-drafted content briefs (optional)

Set `ANTHROPIC_API_KEY` in `.env` and briefs for the top opportunities are
drafted by Claude — primary/secondary keywords, search intent, a heading
outline, and People-Also-Ask-style questions. Without a key, every brief
falls back to the rule-based placeholder in `src/ai/brief.ts`; either way
each brief is labeled with its `source` and is meant to be reviewed by a
human before it reaches a writer.

```bash
npm run dev -- run --site example.com --competitors competitor1.com \
  --briefs 10 --business-context "assisted-living operators"
```

`--briefs 0` skips brief drafting entirely; `--no-ai` forces the rule-based
drafter even if a key is set.

### Adding keyword volume (optional, paid)

Set `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` in `.env` (get credentials at
[dataforseo.com](https://dataforseo.com), ~$0.002/keyword on the Live
endpoint) and content-gap opportunities are re-scored using real monthly
search volume instead of the competitor-coverage-count heuristic.

### Run history and "what changed"

Every `run` saves a timestamped snapshot to `.get-found/history/` (one JSON
file per run, gitignored — no database). From the second run on, the report
gets a **Changes since last run** section: new opportunities, resolved ones,
and score/position moves. This is the prerequisite for daily/Slack alerts
and a dashboard — both just read this same history.

```bash
npm run dev -- run --site example.com --competitors competitor1.com
# second run onward automatically diffs against the last saved snapshot
```

`--history-dir <path>` changes where snapshots are stored; `--no-save-history`
diffs against prior runs without writing a new snapshot (useful in CI or for
a dry run).

## Development

```bash
npm test        # vitest, golden tests for the gap-engine
npm run typecheck
npm run build
```

## Status

v0.4 — collectors + gap-engine spine, a working CLI, Claude-backed brief
drafting (`src/ai/brief.ts`), a DataForSEO keyword-volume adapter
(`src/collectors/dataforseo.ts`), a GSC OAuth setup script (`npm run
gsc:auth`), a file-based history/diff layer (`src/history/`), and fuzzy
topic matching so reworded headings ("Memory Care Pricing" vs. "Pricing
for Memory Care") collapse into one opportunity instead of two.

Every crawl request now times out instead of hanging, and honors a
site's declared `robots.txt` `Crawl-delay` rather than only the CLI's
default. CI runs typecheck, tests, and build on every push/PR to `main`.
Not yet implemented: Slack/alerting delivery, a dashboard, and a review UI
— all three build on the history layer above.

## License

Apache-2.0
