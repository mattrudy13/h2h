// Shared by cfb-h2h.html and cbb-h2h.html: team-name resolution (aliases and
// typos), team colors and logos, the scoreboard and games table, shareable
// ?t1=&t2= links, the swap button and the loading skeleton.
// Pages provide the elements #team1, #team2, #swap, #status, #suggest,
// #result and #rivalries.

// ---- Small helpers ----

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setStatus(msg, isError) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ---- Team-name resolution ----

// Lowercase, "&" -> "and", drop punctuation, and expand a trailing "St" to
// "State" (so "Ohio St." matches, while "St. John's" is left alone).
function normalizeName(s) {
  const words = String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1 && words[words.length - 1] === "st") words[words.length - 1] = "state";
  return words.join(" ");
}

// Maps normalized names to canonical school names, and records each school's
// colors and logos. `aliasFields` are extra name fields (strings or arrays);
// `metaOf(team)` returns { color, altColor, abbr, logos } in the API's format.
function buildTeamIndex(teams, aliasFields, metaOf) {
  const bySchool = new Map();
  const byAlias = new Map();
  const meta = new Map();
  for (const t of teams) {
    if (!t.school) continue;
    bySchool.set(normalizeName(t.school), t.school);
    for (const field of aliasFields) {
      for (const alias of [].concat(t[field] || [])) {
        const key = normalizeName(alias);
        if (!key) continue;
        if (!byAlias.has(key)) byAlias.set(key, new Set());
        byAlias.get(key).add(t.school);
      }
    }
    // The basketball list repeats some schools; keep the entry that has a logo.
    const m = parseMeta(metaOf(t));
    const prev = meta.get(t.school);
    if (!prev || (!prev.logo && m.logo)) meta.set(t.school, m);
  }
  return { bySchool, byAlias, meta, schools: [...new Set(bySchool.values())] };
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Returns { name } for a confident match, otherwise { suggestions: [...] }.
function resolveTeam(input, index) {
  const key = normalizeName(input);
  if (index.bySchool.has(key)) return { name: index.bySchool.get(key) };

  const aliasHits = [...(index.byAlias.get(key) || [])];
  if (aliasHits.length === 1) return { name: aliasHits[0] };

  // Ambiguous alias (e.g. "OSU") or no match: rank close names.
  const scored = [];
  for (const school of index.schools) {
    const s = normalizeName(school);
    let score;
    if (aliasHits.includes(school)) score = 0;
    else if (key.length >= 2 && s.startsWith(key)) score = 1;
    else if (key.length >= 3 && s.includes(key)) score = 2;
    else {
      const d = levenshtein(key, s);
      if (d <= 3) score = 2 + d;
    }
    if (score !== undefined) scored.push({ school, score });
  }
  scored.sort((a, b) => a.score - b.score || a.school.localeCompare(b.school));
  return { suggestions: scored.slice(0, 5).map(x => x.school) };
}

// Resolves both inputs. On success, writes the canonical names back into the
// inputs and returns { t1, t2, note }. If either name is unrecognized, shows
// suggestions and returns null. With no team list loaded, passes names through.
function resolvePair(raw1, raw2, index, onPick) {
  if (!index) return { t1: raw1, t2: raw2, note: "" };
  const inputs = [document.getElementById("team1"), document.getElementById("team2")];
  const raws = [raw1, raw2];
  const names = [];
  const notes = [];
  for (let i = 0; i < 2; i++) {
    const r = resolveTeam(raws[i], index);
    if (!r.name) {
      showSuggestions(inputs[i], raws[i], r.suggestions, onPick);
      return null;
    }
    names.push(r.name);
    if (r.name !== raws[i]) {
      inputs[i].value = r.name;
      if (normalizeName(r.name) !== normalizeName(raws[i])) notes.push(`${r.name} for "${raws[i]}"`);
    }
  }
  refreshInputLogos(index);
  return { t1: names[0], t2: names[1], note: notes.length ? `Showing ${notes.join(" and ")}.` : "" };
}

function showSuggestions(input, raw, suggestions, onPick) {
  const box = document.getElementById("suggest");
  box.replaceChildren();
  if (!suggestions.length) {
    setStatus(`Didn't recognize "${raw}". Pick a team from the list.`, true);
    return;
  }
  setStatus(`Didn't recognize "${raw}". Did you mean:`, true);
  for (const name of suggestions) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = name;
    chip.addEventListener("click", () => {
      input.value = name;
      onPick();
    });
    box.appendChild(chip);
  }
}

function clearSuggestions() {
  document.getElementById("suggest").replaceChildren();
}

// ---- Colors and logos ----

function normalizeHex(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim());
  return m ? "#" + m[1].toLowerCase() : null;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function isNearWhite(hex) {
  return hexToRgb(hex).every(v => v > 225);
}

// Stable color for teams the API has no color for.
const FALLBACK_COLORS = ["#1f6feb", "#8250df", "#bf3989", "#cf222e", "#bc4c00", "#4d7c0f", "#0f766e", "#57606a"];
function fallbackColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

function parseMeta({ color, altColor, abbr, logos }) {
  const list = logos || [];
  return {
    color: normalizeHex(color),
    altColor: normalizeHex(altColor),
    abbr: abbr || "",
    logo: list.find(u => /\/128\//.test(u) && !/-dark\//.test(u)) || null,
    logoDark: list.find(u => /-dark\/128\//.test(u)) || null,
  };
}

function teamMeta(index, name) {
  const m = index && index.meta.get(name);
  return {
    color: (m && m.color) || fallbackColor(name),
    altColor: m && m.altColor,
    abbr: (m && m.abbr) || "",
    logo: m && m.logo,
    logoDark: m && m.logoDark,
  };
}

// Picks the two colors for a matchup. If they're hard to tell apart (e.g. two
// navy schools), team2 uses its alternate color, or a fallback.
function matchupColors(m1, m2, name2) {
  let c2 = m2.color;
  if (colorDistance(m1.color, c2) < 90) {
    if (m2.altColor && !isNearWhite(m2.altColor) && colorDistance(m1.color, m2.altColor) >= 90) c2 = m2.altColor;
    else c2 = FALLBACK_COLORS.reduce((best, c) => colorDistance(m1.color, c) > colorDistance(m1.color, best) ? c : best);
  }
  return [m1.color, c2];
}

function initials(name, abbr) {
  if (abbr && abbr.length <= 4) return abbr.toUpperCase();
  const words = String(name).split(/\s+/).filter(w => !/^(of|the|and|at|&)$/i.test(w));
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join("").toUpperCase();
}

// Logo with a colored-initials fallback for teams with no (or a broken) logo.
function logoHtml(meta, name, size) {
  const img = meta.logo
    ? `<picture>${meta.logoDark ? `<source media="(prefers-color-scheme: dark)" srcset="${esc(meta.logoDark)}">` : ""}<img src="${esc(meta.logo)}" alt="" loading="lazy" onerror="this.closest('.logo').classList.add('no-img')"></picture>`
    : "";
  return `<span class="logo ${size}${meta.logo ? "" : " no-img"}" style="--team:${meta.color}" aria-hidden="true">${img}<span class="initials">${esc(initials(name, meta.abbr))}</span></span>`;
}

// Small logo inside each input once it names a known team.
function refreshInputLogos(index) {
  if (!index) return;
  for (const id of ["team1", "team2"]) {
    const input = document.getElementById(id);
    const wrap = input.closest(".input-wrap");
    const slot = wrap.querySelector(".input-logo");
    const key = normalizeName(input.value);
    const aliasHits = [...(index.byAlias.get(key) || [])];
    const name = index.bySchool.get(key) || (aliasHits.length === 1 ? aliasHits[0] : null);
    wrap.classList.toggle("has-logo", !!name);
    slot.innerHTML = name ? logoHtml(teamMeta(index, name), name, "sm") : "";
  }
}

function initInputLogos(getIndex) {
  for (const id of ["team1", "team2"]) {
    const input = document.getElementById(id);
    for (const ev of ["change", "blur", "input"]) input.addEventListener(ev, () => refreshInputLogos(getIndex()));
  }
}

// ---- Results ----

// "121 games · 1897–2025", "1 game · 2015"
function gamesSummary(count, seasons) {
  const lo = Math.min(...seasons);
  const hi = Math.max(...seasons);
  return `${count} game${count === 1 ? "" : "s"} · ${lo === hi ? lo : `${lo}–${hi}`}`;
}

function renderSkeleton() {
  document.getElementById("result").innerHTML = `
    <div class="card skeleton" aria-hidden="true">
      <div class="skel-row"><div class="skel circle"></div><div class="skel nums"></div><div class="skel circle"></div></div>
      <div class="skel line"></div>
      <div class="skel text"></div>
    </div>`;
}

// `rows` are normalized games:
// { date, season, badges: [], home, away, homePts, awayPts, winner (name or null), upcoming }
function renderMatchup({ team1, team2, wins1, wins2, ties, metaLine, rows }, index) {
  const m1 = teamMeta(index, team1);
  const m2 = teamMeta(index, team2);
  const [c1, c2] = matchupColors(m1, m2, team2);
  const colorOf = n => {
    const k = String(n).toLowerCase();
    return k === team1.toLowerCase() ? c1 : k === team2.toLowerCase() ? c2 : null;
  };

  const verdict = wins1 === wins2 ? "Series tied"
    : `${wins1 > wins2 ? team1 : team2} leads the series`;
  const cls = (a, b) => (a >= b ? "" : "trail");
  const total = wins1 + wins2 + ties;

  const board = `
    <section class="card scoreboard" style="--c1:${c1};--c2:${c2}">
      <div class="sb-team">${logoHtml(m1, team1, "lg")}<div class="sb-name">${esc(team1)}</div></div>
      <div class="sb-center">
        <div class="sb-nums"><span class="${cls(wins1, wins2)}">${wins1}</span><span class="dash">–</span><span class="${cls(wins2, wins1)}">${wins2}</span></div>
        <div class="sb-verdict">${esc(verdict)}</div>
        ${ties ? `<span class="pill sb-ties">${ties} tie${ties === 1 ? "" : "s"}</span>` : ""}
      </div>
      <div class="sb-team">${logoHtml(m2, team2, "lg")}<div class="sb-name">${esc(team2)}</div></div>
      ${total ? `<div class="sb-bar" role="img" aria-label="${wins1} ${esc(team1)} wins, ${ties} ties, ${wins2} ${esc(team2)} wins">
        <i class="b1" style="flex:${wins1}"></i><i class="bt" style="flex:${ties}"></i><i class="b2" style="flex:${wins2}"></i>
      </div>` : ""}
      <div class="sb-meta"><span>${esc(metaLine)}</span><button id="copy-link" class="link-btn" type="button">Copy link</button></div>
    </section>`;

  const rowHtml = g => {
    const homeWon = !g.upcoming && g.winner && g.winner === g.home;
    const awayWon = !g.upcoming && g.winner && g.winner === g.away;
    const score = g.upcoming ? "—"
      : `${homeWon ? `<b>${esc(g.homePts)}</b>` : esc(g.homePts ?? "?")}–${awayWon ? `<b>${esc(g.awayPts)}</b>` : esc(g.awayPts ?? "?")}`;
    const winnerCell = g.upcoming ? `<span class="pill">Upcoming</span>`
      : g.winner ? `<span class="dot" style="${colorOf(g.winner) ? `background:${colorOf(g.winner)}` : ""}"></span>${esc(g.winner)}`
      : `<span class="dot"></span>Tie`;
    const badges = (g.badges || []).map(b => `<span class="pill${b.post ? " post" : ""}">${esc(b.text)}</span>`).join(" ");
    return `<tr${g.upcoming ? ' class="upcoming"' : ""}>
      <td>${fmtDate(g.date)}</td>
      <td>${esc(g.season)} ${badges}</td>
      <td class="team${homeWon ? " won" : ""}">${esc(g.home)}</td>
      <td class="team${awayWon ? " won" : ""}">${esc(g.away)}</td>
      <td class="score">${score}</td>
      <td class="winner">${winnerCell}</td>
    </tr>`;
  };

  const table = `
    <section class="card games">
      <div class="games-head"><h2 class="section-label">Every meeting</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Season</th><th>Home</th><th>Away</th><th>Score</th><th>Winner</th></tr></thead>
          <tbody>${rows.map(rowHtml).join("")}</tbody>
        </table>
      </div>
    </section>`;

  document.getElementById("result").innerHTML = board + table;
}

// ---- Shareable links ----

function readTeamsFromUrl() {
  const params = new URLSearchParams(location.search);
  const t1 = (params.get("t1") || "").trim();
  const t2 = (params.get("t2") || "").trim();
  return t1 && t2 ? { t1, t2 } : null;
}

// replaceState, so repeated compares don't fill the Back-button history.
function writeTeamsToUrl(t1, t2) {
  const params = new URLSearchParams({ t1, t2 });
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

function matchupHref(t1, t2) {
  return "?" + new URLSearchParams({ t1, t2 });
}

function autoRunFromUrl(compare) {
  const teams = readTeamsFromUrl();
  if (!teams) return;
  document.getElementById("team1").value = teams.t1;
  document.getElementById("team2").value = teams.t2;
  compare();
}

// The button is re-rendered with each result, so listen at the document level.
function initCopyLink() {
  document.addEventListener("click", async e => {
    const btn = e.target.closest("#copy-link");
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = "Copied!";
    } catch {
      btn.textContent = "Copy failed. Use the address bar.";
    }
    setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
  });
}

// ---- Empty state ----

// Rivalry chips shown until a matchup is loaded. Clicking runs it in place;
// the href still works for opening in a new tab.
function initRivalries(pairs, compare) {
  const box = document.getElementById("rivalries");
  const chips = box.querySelector(".chips");
  for (const [a, b] of pairs) {
    const chip = document.createElement("a");
    chip.className = "chip";
    chip.href = matchupHref(a, b);
    chip.textContent = `${a} vs ${b}`;
    chip.addEventListener("click", e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      document.getElementById("team1").value = a;
      document.getElementById("team2").value = b;
      compare();
    });
    chips.appendChild(chip);
  }
  const result = document.getElementById("result");
  const sync = () => { box.hidden = result.children.length > 0; };
  new MutationObserver(sync).observe(result, { childList: true });
  sync();
}

// ---- Swap ----

function initSwap(compare, getIndex) {
  document.getElementById("swap").addEventListener("click", () => {
    const a = document.getElementById("team1");
    const b = document.getElementById("team2");
    [a.value, b.value] = [b.value, a.value];
    refreshInputLogos(getIndex());
    if (document.querySelector("#result .scoreboard")) compare();
  });
}
