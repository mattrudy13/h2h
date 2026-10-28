// Proxy for the CollegeFootballData / CollegeBasketballData APIs.
// The API key lives in the Worker as a secret (CFBD_API_KEY), so it never
// reaches the browser. Pages call  <worker>/cfb/...  or  <worker>/cbb/...

const UPSTREAMS = {
  cfb: "https://api.collegefootballdata.com",
  cbb: "https://api.collegebasketballdata.com",
};

// Only the endpoints the site actually uses, each with the query params it
// takes, so the Worker can't be used as a general-purpose open proxy for the key.
// Other params are dropped: they'd make a new cache key per request and let
// anyone skip the cache and spend the API quota.
const ALLOWED = {
  cfb: { "/teams/fbs": [], "/teams/matchup": ["team1", "team2"] },
  cbb: { "/teams": [], "/games": ["team"] },
};
const MAX_PARAM_LENGTH = 100;

// /record answers with just the series totals, computed here from the cached
// upstream data. The landing page shows six records, and basketball has no
// matchup endpoint: each team's full history is ~1.7 MB, too much to send to
// a phone for three numbers.
const RECORD_PARAMS = ["team1", "team2"];

const ALLOWED_ORIGINS = ["https://mattrudy13.github.io"];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// How long Cloudflare keeps each response, to spare the API quota.
// Team lists barely change. Game data only changes during the season, so it's
// cached briefly then (new results show up within half a day) and for a week
// in the off-season.
const HOUR = 60 * 60;
const TEAM_LIST_SECONDS = 7 * 24 * HOUR;
const IN_SEASON_SECONDS = 12 * HOUR;
const OFF_SEASON_SECONDS = 7 * 24 * HOUR;
// Browsers keep their own copy for at most this long, since it can't be purged.
const BROWSER_SECONDS = HOUR;

// UTC months (0 = Jan) when games are being played.
const SEASON_MONTHS = {
  cfb: [7, 8, 9, 10, 11, 0], // Aug–Jan, incl. bowls and the playoff
  cbb: [10, 11, 0, 1, 2, 3], // Nov–Apr, incl. the tournaments
};

// Bump to drop everything cached under the old key (workers.dev has no purge button).
const CACHE_VERSION = "2";

function cacheSeconds(sport, path, now = new Date()) {
  if (path.startsWith("/teams") && path !== "/teams/matchup") return TEAM_LIST_SECONDS;
  return SEASON_MONTHS[sport].includes(now.getUTCMonth()) ? IN_SEASON_SECONDS : OFF_SEASON_SECONDS;
}

function cacheKeyFor(url) {
  const keyUrl = new URL(url);
  keyUrl.searchParams.set("cache_v", CACHE_VERSION);
  return new Request(keyUrl.toString());
}

// Returns the upstream response from Cloudflare's cache, or fetches and caches it.
// Returns null when this IP is over the cache-miss limit.
async function cachedUpstream(sport, path, search, env, ctx, ip) {
  const upstreamUrl = UPSTREAMS[sport] + path + (String(search) ? "?" + search : "");
  const cache = caches.default;
  const cacheKey = cacheKeyFor(upstreamUrl);
  let upstream = await cache.match(cacheKey);
  if (upstream) return upstream;

  // Only cache misses spend quota, so only they count toward the per-IP limit.
  // Varying team names still skips the cache, so the param allowlist alone isn't enough.
  const { success } = await env.UPSTREAM_LIMITER.limit({ key: ip });
  if (!success) return null;
  const res = await fetch(upstreamUrl, {
    headers: { Authorization: "Bearer " + env.CFBD_API_KEY, Accept: "application/json" },
  });
  upstream = new Response(res.body, res);
  upstream.headers.delete("Set-Cookie");
  if (res.ok) {
    upstream.headers.set("Cache-Control", `public, max-age=${cacheSeconds(sport, path)}`);
    ctx.waitUntil(cache.put(cacheKey, upstream.clone()));
  }
  return upstream;
}

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// Series totals for team1 vs team2: wins each way, ties, games played, the
// first season and the next scheduled game (basketball only).
async function seriesRecord(sport, team1, team2, env, ctx, ip) {
  const football = sport === "cfb";
  const res = football
    ? await cachedUpstream(sport, "/teams/matchup", new URLSearchParams({ team1, team2 }), env, ctx, ip)
    : await cachedUpstream(sport, "/games", new URLSearchParams({ team: team1 }), env, ctx, ip);
  if (!res || !res.ok) return res;
  const data = await res.json();

  if (football) {
    const games = data.games || [];
    return {
      team1: data.team1 || team1, team2: data.team2 || team2,
      wins1: data.team1Wins || 0, wins2: data.team2Wins || 0, ties: data.ties || 0,
      games: games.length,
      first: games.length ? Math.min(...games.map(g => g.season)) : null,
      next: null,
    };
  }

  // Same rules as the basketball page: only finished games count, and
  // scheduled ones in the future are upcoming.
  const now = Date.now();
  const rec = { team1, team2, wins1: 0, wins2: 0, ties: 0, games: 0, first: null, next: null };
  for (const g of data) {
    const homeIs1 = same(g.homeTeam, team1);
    if (!(homeIs1 ? same(g.awayTeam, team2) : same(g.homeTeam, team2) && same(g.awayTeam, team1))) continue;
    rec.team1 = homeIs1 ? g.homeTeam : g.awayTeam;
    rec.team2 = homeIs1 ? g.awayTeam : g.homeTeam;
    if (g.status === "final") {
      const won1 = homeIs1 ? g.homeWinner : g.awayWinner;
      const won2 = homeIs1 ? g.awayWinner : g.homeWinner;
      if (won1) rec.wins1++; else if (won2) rec.wins2++; else rec.ties++;
      rec.games++;
      if (rec.first === null || g.season < rec.first) rec.first = g.season;
    } else if (new Date(g.startDate) > now && (!rec.next || g.startDate < rec.next)) {
      rec.next = g.startDate;
    }
  }
  return rec;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin =
      ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin) ? origin : null;
    const cors = {
      ...(allowOrigin && { "Access-Control-Allow-Origin": allowOrigin }),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }
    if (!allowOrigin) {
      return new Response("Origin not allowed", { status: 403, headers: cors });
    }

    const url = new URL(request.url);
    const [, sport, ...rest] = url.pathname.split("/");
    const path = "/" + rest.join("/");
    const isRecord = UPSTREAMS[sport] && path === "/record";
    const params = isRecord ? RECORD_PARAMS
      : UPSTREAMS[sport] && Object.hasOwn(ALLOWED[sport], path) ? ALLOWED[sport][path] : null;
    if (!params) {
      return new Response("Not found", { status: 404, headers: cors });
    }
    const search = new URLSearchParams();
    for (const name of params) {
      const value = url.searchParams.get(name);
      if (!value || value.length > MAX_PARAM_LENGTH) {
        return new Response(`Missing or invalid ${name}`, { status: 400, headers: cors });
      }
      search.set(name, value);
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const tooMany = () => new Response("Too many requests, try again in a minute", { status: 429, headers: { ...cors, "Retry-After": "60" } });

    let upstream;
    if (isRecord) {
      // Cache the small result too, so the big history is only parsed once per cache period.
      const cacheKey = cacheKeyFor(`https://h2h-record.internal/${sport}?${search}`);
      upstream = await caches.default.match(cacheKey);
      if (!upstream) {
        const rec = await seriesRecord(sport, search.get("team1"), search.get("team2"), env, ctx, ip);
        if (!rec) return tooMany();
        if (rec instanceof Response) {
          upstream = rec;
        } else {
          upstream = new Response(JSON.stringify(rec), {
            headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${cacheSeconds(sport, path)}` },
          });
          ctx.waitUntil(caches.default.put(cacheKey, upstream.clone()));
        }
      }
    } else {
      upstream = await cachedUpstream(sport, path, params.length ? search : "", env, ctx, ip);
      if (!upstream) return tooMany();
    }

    const response = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    if (response.ok) response.headers.set("Cache-Control", `public, max-age=${BROWSER_SECONDS}`);
    return response;
  },
};
