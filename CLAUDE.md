# h2h — project notes

All-time head-to-head records between college teams (football and men's basketball),
published as a static site on GitHub Pages: https://mattrudy13.github.io/h2h/
See README.md for usage, local running and deploy commands; ENHANCEMENTS.md for the idea list.

## Status (2026-10-05)

Live and working end to end:
- Team vs Team: scoreboard (logos, team colors, record bar), series highlights (current and
  longest streaks, last meeting, biggest wins), record-by-decade chart, games table.
- Team vs Conference: a team's record against every current member of a conference.
- Shareable URLs (`?t1=&t2=`, `?t1=&conf=`), typo/alias handling, swap, copy link, mobile
  layout, dark mode, loading skeleton, rivalry quick picks, landing page.
- Cloudflare Worker proxy with season-aware caching (deployed, version with `CACHE_VERSION = "2"`).

Next steps: open items in ENHANCEMENTS.md (home/away/neutral split, bowl/tournament record,
date-range filter, Worker rate limit, CI smoke test, FCS teams in the football picker).

## Layout

- `index.html`: landing page. `cfb-h2h.html` / `cbb-h2h.html`: the two sport pages.
- `style.css`: all styles for all three pages. Sport accent via `<body data-sport="cfb|cbb">`;
  conference mode via `body[data-mode="conf"]` (set by `setMode()`).
- `common.js`: everything shared: name resolution, team metadata (colors/logos/conferences),
  scoreboard + highlights + decade chart + games table rendering, conference view, URL
  handling, swap, copy link, rivalry chips. Plain global functions, no modules or build step.
- `proxy-config.js`: the Worker URL (`window.H2H_PROXY`). Not a secret.
- `worker/`: the Cloudflare Worker (`src/index.js`, `wrangler.toml`). `worker/.dev.vars` holds
  the API key for `wrangler dev` and is gitignored.

Per-page code (in each sport page's inline `<script>`) is limited to: `apiFetch`, `loadTeams`
(passes the sport's field names to `buildTeamIndex`), `compare()` (fetch + normalize games
into rows), `fetchVsMembers()` (conference data) and init calls. Rendering lives in common.js.

## The API key never reaches the browser

Both APIs (CollegeFootballData / CollegeBasketballData, same key) need a bearer token. Pages
call the Worker (`h2h-proxy.mattrudy13.workers.dev/cfb/...` or `/cbb/...`), which adds the
key from the Cloudflare secret `CFBD_API_KEY`. Never commit the key, never put it in a page,
and never add a client-side fallback that reads it (an old `cfb-config.js` approach was
removed for this reason; it's still in `.gitignore`).

The Worker:
- only answers `Origin: https://mattrudy13.github.io` and `localhost`/`127.0.0.1` (403
  otherwise; opening the pages as `file://` sends `Origin: null` and fails, so serve over HTTP).
- only forwards allowlisted endpoints (`ALLOWED_PATHS`). **A page that needs a new endpoint
  needs a Worker change and a redeploy**, or it gets 404.
- Pushing to GitHub does **not** deploy the Worker. Deploy with `cd worker && npx wrangler deploy`
  (the user is logged in to wrangler on this Mac).

## Caching (worker/src/index.js)

- Cloudflare cache: team lists 7 days; matchups/game lists 12 h in season (football Aug–Jan,
  basketball Nov–Apr, UTC months) and 7 days off-season.
- Browser `Cache-Control` is capped at 1 h separately, because browser copies can't be purged.
- workers.dev has no purge button: bump `CACHE_VERSION` and redeploy to drop the cache.
- Only `res.ok` responses are cached.

## API data quirks

- **Football** `/teams/matchup?team1=&team2=` returns the whole series in one call
  (`team1Wins`, `team2Wins`, `ties`, `games[]` with `homeScore`/`awayScore`/`winner`/`seasonType`).
  There is no per-team history endpoint without a year, so **Team vs Conference makes one
  matchup call per member** (~17 for the Big Ten), throttled 4 at a time via `mapLimit`.
  Keep that in mind for API quota.
- **Basketball** has no matchup endpoint: `/games?team=X` returns a team's entire history
  (large; slow when uncached) and the page filters to the opponent client-side.
  - Unplayed games come back as `status: "scheduled"` with a **0–0 score and no winner**.
    Only `status === "final"` games count toward records; future ones are shown as upcoming,
    past non-final ones (postponed/cancelled) are dropped. An old bug counted them as ties.
  - `/teams` has 1,535 rows with duplicate `school` names (dedupe; prefer the row with a logo),
    and about half have **no logo or color**, so fallbacks are required (initials circle,
    hashed color from `FALLBACK_COLORS`). Colors are hex **without `#`**; football's have it.
    `normalizeHex()` handles both.
  - ~1,170 teams have `conference: null` (non-D1); they're excluded from the conference list.
- Football's "FBS Independents" is excluded from the conference list (not a conference).
- Logos: pick the `/128/` URLs from `logos[]`; `-dark/` variants are used in dark mode via `<picture>`.
- Cloudflare may 403 requests with Python's default `urllib` user agent; use curl or Playwright
  when testing the Worker from scripts.

## Name resolution (common.js)

`normalizeName` lowercases, maps `&`→`and`, strips punctuation, and expands a trailing `St`
to `State` (only the last word, so "St. John's" survives). `resolveTeam` tries: exact school →
alias with exactly one match (abbreviations, `alternateNames`, display names) → suggestions
(prefix, substring, Levenshtein ≤ 3). Ambiguous aliases show suggestion chips instead of
guessing. Canonical names are written back into the inputs and the URL.

## Design choices (frontend)

- "Scoreboard" visual direction (chosen by the user): Barlow Condensed (display) + Inter (body)
  from Google Fonts, dark top bar with sport tabs, team-colored scoreboard card.
- Team colors carry identity; text stays in text colors (`--fg`/`--muted`), never team colors.
- If the two teams' colors are too close (`colorDistance < 90`), team 2 uses its alternate
  color, else the farthest `FALLBACK_COLORS` entry (`matchupColors`).
- Decade chart: mirrored bars on one shared scale, ties only in the hover/focus tooltip
  (one `.chart-tip` per chart, listeners delegated on `document` in `initChartTips`).
- Escape all API text with `esc()` before putting it in HTML; build user-typed text with
  `textContent`.
- Copy link, opponent links and swap use document-level delegation because results are
  re-rendered on every compare.

## Dev notes

- No build step, no package.json. Serve locally with
  `python3 -m http.server 8000 --bind 127.0.0.1` (uses the deployed Worker). For Worker changes,
  `cd worker && npx wrangler dev` and point `proxy-config.js` at `http://localhost:8787`
  temporarily (switch back before committing).
- Testing has been done with Playwright from the apartments repo's venv
  (`../apartments/.venv/bin/python`, Chromium installed there): load pages headless, assert on
  `#status`, `.scoreboard`, `.sb-nums`, `.hl`, `.dec-row`, check
  `document.documentElement.scrollWidth <= 375` at phone width, light and dark
  (`color_scheme="dark"`), and no console errors or failed responses. Screenshot and look
  at layout changes before shipping.
- Good test matchups: Michigan–Ohio State (football, 121 games, 6 ties), Duke–North Carolina
  (basketball, includes 2 upcoming games), Mount Vernon Nazarene (OH)–Cleveland State
  (basketball team with no logo/color), Michigan–Penn State (similar colors),
  Michigan vs Big Ten / Duke vs ACC (conference mode).
- GitHub Pages deploys from `main` (root) about a minute after a push.
- Commit messages use `feat:` / `docs:` / `feat(worker):` prefixes.
