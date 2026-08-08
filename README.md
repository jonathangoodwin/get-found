# get-found

[![CI](https://github.com/jonathangoodwin/get-found/actions/workflows/ci.yml/badge.svg)](https://github.com/jonathangoodwin/get-found/actions/workflows/ci.yml)

Agentic SEO in a box. Point it at your domain and a few competitors; it
crawls both, pulls your Google Search Console data, and produces a ranked
report of:

- **New content opportunities** — topics your competitors cover that you don't.
- **Quick wins** — your own pages ranking positions 11-30 ("striking distance")
  that need improvement rather than a new page from scratch.
- **Tracked rankings** — your top queries by impressions, page 1 included, so a
  ranking sliding backwards shows up even though it's not a content gap.
- **Site health** — broken links, missing/duplicate titles and meta
  descriptions, missing H1s, thin content, missing schema, noindex pages.
- **Sitemap status** — submitted-vs-indexed counts and errors, from Search Console.
- **Core Web Vitals** — real-user LCP/INP/CLS, from the Chrome UX Report.
- **Link building opportunities** *(opt-in)* — domains linking to your
  competitors but not you, with a publicly-published contact channel and a
  draft outreach message for each — never sent automatically.
- **Trending now** *(opt-in)* — this run's topics and tracked queries,
  cross-checked against Google's real-time trending searches, with a news
  link as evidence when one of yours is currently taking off.

## Design

The engine is a deterministic spine with an optional AI layer on top, so the
core tool runs with zero API keys:

```
collectors/   crawl sitemaps + Search Console + Chrome UX Report — no LLM involved
gap-engine/   pure functions: topic extraction, gap scoring, striking distance, ranking watch
health/       pure structural site-health checks on already-crawled pages
history/      snapshot storage (I/O) + pure run-to-run diffing
orchestrate/  the shared analysis pipeline — the CLI and Slack both call this
report/       markdown report rendering
slack/        config store, pure Block Kit formatter, run guards, daily
              scheduler, and the Bolt (Socket Mode) wiring on top of them
ai/           typed BriefDrafter + OutreachDrafter interfaces; rule-based
              fallbacks ship today, LLM-backed drafters implement the same
              interfaces — every output is draft-only, human reviews before use
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

### Link building / backlink gap (optional, paid, opt-in)

Domains that link to at least one competitor but not to you — the same
[DataForSEO](https://dataforseo.com) credentials as keyword volume power
this via the Backlinks API's Domain Intersection endpoint, a **separate,
additional cost** from keyword lookups. Off by default; pass `--link-gap`
to enable it.

```bash
npm run dev -- run --site example.com --competitors competitor1.com \
  --link-gap --outreach-drafts 10
```

For the top targets (`--outreach-drafts`, default 10), get-found also:

1. Crawls the target's own site for a **publicly published** contact
   channel — a `mailto:` link, a linked contact page, a social profile.
   It never guesses or invents an email address; if the site hasn't
   published one, you get "no contact found," not a fabricated one.
2. Drafts a personalized outreach message (Claude if `ANTHROPIC_API_KEY`
   is set, a rule-based placeholder otherwise) explaining why a link would
   help *their* audience, not just why it helps you.

**get-found never sends outreach.** Every draft is labeled and printed for
you to review, personalize further, and send yourself. This is a hard
design boundary, not a v1 limitation to be lifted later — the alternative
(an agent auto-emailing a list of webmasters) is a spam pipeline, not an
outreach tool.

Not built: broken-link building (competitor pages that earned links and
now 404) and unlinked-brand-mention detection (real, but needs a web/SERP
search data source we haven't wired up) — both are real link-building
tactics, deliberately out of v1 scope rather than half-built.

### Trends watcher (optional, free, opt-in)

There's no official Google Trends API, and the closest thing to one — the
unofficial `interest over time` endpoint that libraries like `pytrends`
scrape — broke in 2026: Google changed the session bootstrap it relies on
(a cookie warm-up before a two-hop token exchange), and any real workload
now needs proxy rotation to avoid 429s. That's not something worth building
into a self-hosted CLI tool.

What *is* stable and doesn't need auth or a token dance is Google's
real-time **Trending now** feed — the same general search trends shown at
[trends.google.com/trending](https://trends.google.com/trending), exposed
as a plain RSS feed. `--trends` fetches it and fuzzy-matches it (the same
topic matching used for content gaps) against this run's own topics: its
content-gap opportunities, striking-distance and tracked-ranking queries,
plus anything you list explicitly with `--trends-topics`. A match means a
topic you already care about is trending *right now*, with a news link as
evidence for why.

```bash
npm run dev -- run --site example.com --competitors competitor1.com \
  --trends --trends-geo US --trends-topics "extra topic, another topic"
```

This is a **general trending-searches signal, not keyword-specific search
history** — it surfaces a match only when a broad trending search happens
to overlap one of your topics, not a rising/falling trend line for a
keyword you pick. Off by default (`--trends` / Slack `config trends on`)
since it's still an undocumented endpoint making a live request to Google
on every run, even though it costs nothing and needs no API key.

### Site health, sitemap status, tracked rankings, and Core Web Vitals

Site health and tracked rankings need no configuration — they run on every
`run` using data already crawled / already fetched from Search Console.
`--thin-content-words <n>` (default 300) changes the thin-content floor.

Sitemap status is included automatically whenever `--gsc-site-url` is set
(same credentials as striking distance — no extra setup).

Core Web Vitals needs `CRUX_API_KEY` in `.env` (free, see `.env.example` for
where to get one). `--cwv-pages <n>` (default 5) caps how many of the own
site's pages get checked, since the Chrome UX Report has no batch endpoint.

One honest limitation: Search Console's full **Index Coverage** report
(soft 404s, crawl anomalies, excluded-page reasons) and **Manual Actions**
have no public API. "Site health" here means what's structurally checkable
plus what Google's APIs actually expose — not a mirror of the GSC web UI.

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

### Slack integration

Runs the exact same analysis pipeline as `run` (`src/orchestrate.ts` — one
place decides what "run an analysis" means, whichever surface calls it),
delivered to a Slack channel instead of stdout.

**Setup:**

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps).
2. Enable **Socket Mode** (Settings → Socket Mode) — no public server needed,
   the bot connects out to Slack over a WebSocket. Generate an app-level
   token with the `connections:write` scope; that's `SLACK_APP_TOKEN`.
3. Add a slash command named `/get-found`.
4. Under OAuth & Permissions, add the `chat:write` and `commands` bot scopes,
   install the app to your workspace, and copy the **Bot User OAuth Token**
   as `SLACK_BOT_TOKEN`.
5. Add both to `.env`, then run:

   ```bash
   npm run dev -- slack
   ```

**Commands** (all under `/get-found`):

- `run` — crawl and analyze the configured site now, posts results when done
- `latest` — post the most recently *saved* report, no crawl (instant)
- `config` — view current config; `config <key> <value>` to set `site`,
  `competitors`, `gsc-site-url`, `channel`, `daily` (on/off), `daily-time`
  (`HH:MM` UTC), `daily-only-on-change` (on/off), `daily-sections` (comma
  list, see `ReportSection` in `src/slack/config.ts` for the options),
  `link-gap` (on/off — paid DataForSEO Backlinks API + outreach drafting,
  off by default same as the CLI's `--link-gap`), `trends` (on/off — free,
  off by default same as the CLI's `--trends`), `trends-geo` (region code,
  default `US`)
- `help`

One active site/channel config per bot instance — not multi-tenant. If you
need several sites in Slack, run separate bot instances with different
`--config-path`.

**Guards:** overlapping `/run` commands and rapid re-triggering are blocked
(`src/slack/guards.ts`) — cost and crawl-politeness protection, not just UX.

**Daily report:** you decide what's in it. `daily-sections` controls which
report sections appear; `daily-only-on-change` (default on) skips posting on
days where nothing moved, so the channel doesn't fill with "no change" noise
— set it off if you'd rather have a steady daily heartbeat regardless.

## Development

```bash
npm test        # vitest, golden tests for the gap-engine
npm run typecheck
npm run build
```

## Status

v0.7 — collectors + gap-engine spine, a working CLI, Claude-backed content
briefs, a DataForSEO keyword-volume adapter, a GSC OAuth setup script, a
file-based history/diff layer, fuzzy topic matching, a broadened standard
crawl (site health, GSC Sitemaps status, Core Web Vitals, page-1-inclusive
ranking watch), a Slack integration (`src/slack/`, Socket Mode) with
`/run`, `/latest`, `/config`, and a configurable daily report, an opt-in
link-gap / backlink builder (`--link-gap`) with publicly-published contact
discovery and draft-only outreach, and an opt-in trends watcher (`--trends`)
matching this run's topics against Google's real-time trending searches —
all running the same shared pipeline (`src/orchestrate.ts`).

Every crawl request now times out instead of hanging, and honors a
site's declared `robots.txt` `Crawl-delay` rather than only the CLI's
default. CI runs typecheck, tests, and build on every push/PR to `main`.
Not yet implemented: a dashboard, broken-link building, unlinked-brand-
mention detection, and keyword-specific trend history (the unofficial
Google Trends endpoint for that broke in 2026 and needs proxy rotation to
use reliably — see the Trends watcher section above).

## License

Apache-2.0
