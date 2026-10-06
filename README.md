# h2h

All-time head-to-head records between any two college teams, for football and men's
basketball. A static site on GitHub Pages: https://mattrudy13.github.io/h2h/

- **Football** (`cfb-h2h.html`): series record, ties and every game, from
  [CollegeFootballData.com](https://collegefootballdata.com)
- **Basketball** (`cbb-h2h.html`): series record and every game, from
  [CollegeBasketballData.com](https://collegebasketballdata.com). Scheduled games are listed as
  upcoming and don't count toward the record.

## How it works

Both APIs need a key, and anything a static page loads is public, so the pages never see
the key. They call a Cloudflare Worker (`worker/`), which adds the key and forwards the
request:

```
browser ──> h2h-proxy.mattrudy13.workers.dev/cfb/... ──> api.collegefootballdata.com
                                             /cbb/... ──> api.collegebasketballdata.com
```

The Worker:
- holds the key as the secret `CFBD_API_KEY`, set in Cloudflare and never in git (one key
  works for both APIs)
- only answers requests from `https://mattrudy13.github.io` and `localhost`
- only forwards the endpoints the site uses (`/cfb/teams/fbs`, `/cfb/teams/matchup`,
  `/cbb/teams`, `/cbb/games`), so it can't be used as an open proxy for the key
- caches successful responses for 6 hours to save API quota

The Worker's URL lives in `proxy-config.js`. It isn't a secret.

## Files

| Path                   | What it is                                           |
|------------------------|------------------------------------------------------|
| `index.html`           | Landing page linking to both sports                  |
| `cfb-h2h.html`         | Football page                                        |
| `cbb-h2h.html`         | Basketball page                                      |
| `proxy-config.js`      | Worker URL the pages call                            |
| `worker/src/index.js`  | The Cloudflare Worker                                |
| `worker/wrangler.toml` | Worker config                                        |
| `worker/.dev.vars`     | API key for local Worker runs (gitignored, not in the repo) |

## Running locally

The pages are plain HTML with no build step. Serve the folder over HTTP rather than opening
the files directly, because the Worker rejects requests whose origin is `file://`:

```sh
python3 -m http.server 8000     # open http://localhost:8000
```

This uses the deployed Worker. To change the Worker itself, run it locally too:

```sh
cd worker
echo "CFBD_API_KEY=<your key>" > .dev.vars   # once; gitignored
npx wrangler dev                            # serves on http://localhost:8787
```

Then point `proxy-config.js` at `http://localhost:8787`, and switch it back before
committing.

## Deploying

- **Pages**: pushing to `main` publishes the site (Settings → Pages → deploy from
  `main`, root). No build step.
- **Worker**: deploys separately, and pushing doesn't deploy it. After changing
  `worker/`:
  ```sh
  cd worker
  npx wrangler deploy
  ```
  The key stays in Cloudflare across deploys. To change it: `npx wrangler secret put CFBD_API_KEY`.

To allow another origin or endpoint, edit `ALLOWED_ORIGINS` / `ALLOWED_PATHS` in
`worker/src/index.js` and redeploy.

## API key

A free key is available at https://collegefootballdata.com/key. If it leaks, get a new one
and update it with `npx wrangler secret put CFBD_API_KEY` and in `worker/.dev.vars`.
