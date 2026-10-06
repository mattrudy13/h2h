// URL of the Cloudflare Worker that proxies the stats APIs (see worker/).
// Not a secret — the API key lives in the Worker.
window.H2H_PROXY = "https://h2h-proxy.mattrudy13.workers.dev";

// When running the Worker locally with `npx wrangler dev`, use:
// window.H2H_PROXY = "http://localhost:8787";
