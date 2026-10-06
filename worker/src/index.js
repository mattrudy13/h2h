// Proxy for the CollegeFootballData / CollegeBasketballData APIs.
// The API key lives in the Worker as a secret (CFBD_API_KEY), so it never
// reaches the browser. Pages call  <worker>/cfb/...  or  <worker>/cbb/...

const UPSTREAMS = {
  cfb: "https://api.collegefootballdata.com",
  cbb: "https://api.collegebasketballdata.com",
};

// Only the endpoints the site actually uses, so the Worker can't be used as
// a general-purpose open proxy for the key.
const ALLOWED_PATHS = {
  cfb: ["/teams/fbs", "/teams/matchup"],
  cbb: ["/teams", "/games"],
};

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
    if (!UPSTREAMS[sport] || !ALLOWED_PATHS[sport].includes(path)) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const upstreamUrl = UPSTREAMS[sport] + path + url.search;
    const cache = caches.default;
    const keyUrl = new URL(upstreamUrl);
    keyUrl.searchParams.set("cache_v", CACHE_VERSION);
    const cacheKey = new Request(keyUrl.toString());

    let upstream = await cache.match(cacheKey);
    if (!upstream) {
      const res = await fetch(upstreamUrl, {
        headers: { Authorization: "Bearer " + env.CFBD_API_KEY, Accept: "application/json" },
      });
      upstream = new Response(res.body, res);
      upstream.headers.delete("Set-Cookie");
      if (res.ok) {
        upstream.headers.set("Cache-Control", `public, max-age=${cacheSeconds(sport, path)}`);
        ctx.waitUntil(cache.put(cacheKey, upstream.clone()));
      }
    }

    const response = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    if (response.ok) response.headers.set("Cache-Control", `public, max-age=${BROWSER_SECONDS}`);
    return response;
  },
};
