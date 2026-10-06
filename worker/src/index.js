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

// Historical results barely change; cache to spare the API quota.
const CACHE_SECONDS = 6 * 60 * 60;

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
    const cacheKey = new Request(upstreamUrl);

    let upstream = await cache.match(cacheKey);
    if (!upstream) {
      const res = await fetch(upstreamUrl, {
        headers: { Authorization: "Bearer " + env.CFBD_API_KEY, Accept: "application/json" },
      });
      upstream = new Response(res.body, res);
      upstream.headers.delete("Set-Cookie");
      if (res.ok) {
        upstream.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
        ctx.waitUntil(cache.put(cacheKey, upstream.clone()));
      }
    }

    const response = new Response(upstream.body, upstream);
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
    return response;
  },
};
