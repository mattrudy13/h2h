# Enhancements

Ideas for the site, roughly in priority order. `[x]` done, `[~]` partly done.

## Quick wins
- [x] **Mobile layout**: `cfb-h2h.html` and `cbb-h2h.html` have no `<meta name="viewport">`,
      so phones render them zoomed out. Add the tag and let the results table scroll
      sideways on narrow screens.
- [x] **Shareable links**: put the matchup in the URL (`cfb-h2h.html?t1=Michigan&t2=Ohio+State`),
      fill it in and run it on load, and update the URL on each compare. Makes results
      bookmarkable and easy to text to someone.
- [x] **Swap button** (⇄) between the two team inputs.
- [x] **Catch typos before calling the API**: an unrecognized name currently just reports "No
      games found". Check it against the loaded team list and suggest close matches (e.g.
      "UNC" → North Carolina, "Ohio St" → Ohio State).

## Better stats
- [ ] **Series highlights**: current streak, longest streak each way, last meeting, biggest
      win each way, average margin. All of these can be computed from the games already
      returned.
- [ ] **Home / away / neutral split**: both APIs flag neutral-site games, so the record can be
      split as "X–Y at home, X–Y away, X–Y neutral".
- [ ] **Record by decade**: a small bar chart showing which team owned which era.
- [ ] **Bowl and tournament games**: highlight postseason rows (football `seasonType`,
      basketball `tournament`) and give them their own record line.
- [ ] **Date-range filter**: "since 2000" or a season slider, so a lopsided 1920s record
      doesn't drown out recent history.

## Look and feel
- [ ] **Team colors and logos**: `/teams/fbs` already returns `color`, `alternateColor` and
      `logos` for every school, so the summary cards could use each team's colors and logo
      at no extra API cost.
- [ ] **Loading state**: a spinner or skeleton table. Uncached basketball lookups pull a
      team's entire game history and can take a few seconds.
- [ ] **Sortable table columns** (by date, margin, venue).

## Coverage
- [ ] **FCS teams in the football picker**: the dropdown only lists FBS schools (`/teams/fbs`),
      though the matchup endpoint accepts any team. Allow `/teams` in the Worker and
      include FCS schools so series like Ohio State vs Youngstown State are findable.
- [ ] **More sports**: CFBD doesn't cover women's basketball, baseball or hockey, so this
      would need another data source. Check what's free before planning.
- [ ] **Team vs conference**: a team's record against every member of a conference, using
      the `conference` field from the team list.

## Code and reliability
- [ ] **Share code between the two pages**: `cfb-h2h.html` and `cbb-h2h.html` duplicate most of
      their CSS and helpers (`apiFetch`, `setStatus`, `fmtDate`). Move them to `style.css`
      and `common.js` so a fix only has to be made once (the unplayed-games bug only
      existed in one copy).
- [ ] **Escape API text before inserting HTML**: rows are built with `innerHTML` from API
      fields (team names, venues). The risk is low because the data comes from a trusted
      API, but an `esc()` helper costs nothing.
- [ ] **Smarter caching in the Worker**: finished seasons never change. Cache past-season
      results for days instead of 6 hours, and keep the current season short.
- [ ] **Rate limit in the Worker**: the origin check stops other websites, but not scripts
      that fake the `Origin` header. A per-IP limit (Cloudflare's rate-limiting binding)
      would protect the API quota if the site were ever shared widely.
- [ ] **Smoke test in CI**: a GitHub Action that loads both pages against the deployed
      Worker and checks one known matchup, so an API or Worker break is caught on push
      instead of by a visitor.
