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
  const conferences = new Map();
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
    const raw = metaOf(t);
    if (raw.conference) {
      if (!conferences.has(raw.conference)) conferences.set(raw.conference, new Set());
      conferences.get(raw.conference).add(t.school);
    }
    const m = parseMeta(raw);
    const prev = meta.get(t.school);
    if (!prev || (!prev.logo && m.logo)) meta.set(t.school, m);
  }
  return { bySchool, byAlias, meta, conferences, schools: [...new Set(bySchool.values())] };
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

  const stats = seriesStats(rows, team1, team2);
  document.getElementById("result").innerHTML =
    board + highlightsHtml(stats, team1, team2, colorOf) + decadesHtml(stats.games, team1, team2, c1, c2) + table;
}

// ---- Series highlights ----

function sameTeam(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

// Streaks, last meeting and biggest wins, from finished games in date order.
function seriesStats(rows, team1, team2) {
  const games = rows.filter(g => !g.upcoming).sort((a, b) => new Date(a.date) - new Date(b.date));
  const side = g => (!g.winner ? null : sameTeam(g.winner, team1) ? team1 : sameTeam(g.winner, team2) ? team2 : null);
  const longest = { [team1]: null, [team2]: null };
  const biggest = { [team1]: null, [team2]: null };
  let current = null;
  for (const g of games) {
    const w = side(g);
    if (w && current && current.team === w) {
      current.n++;
      current.to = g.season;
    } else {
      current = w ? { team: w, n: 1, from: g.season, to: g.season } : null;
    }
    if (current && (!longest[w] || current.n > longest[w].n)) longest[w] = { ...current };
    const hp = Number(g.homePts), ap = Number(g.awayPts);
    if (w && Number.isFinite(hp) && Number.isFinite(ap)) {
      const margin = Math.abs(hp - ap);
      if (!biggest[w] || margin > biggest[w].margin) {
        biggest[w] = { margin, season: g.season, score: `${Math.max(hp, ap)}–${Math.min(hp, ap)}` };
      }
    }
  }
  return { games, current, longest, biggest, last: games[games.length - 1] || null, side };
}

function highlightsHtml(stats, team1, team2, colorOf) {
  if (!stats.games.length) return "";
  const dot = name => `<span class="dot" style="background:${colorOf(name)}"></span>`;
  const shortYears = (a, b) => (a === b ? `${a}` : `${a}–${String(b).slice(String(a).slice(0, 2) === String(b).slice(0, 2) ? 2 : 0)}`);

  const cur = stats.current;
  const curTile = cur
    ? `<div class="hl-value">${cur.n}</div><div class="hl-sub">${dot(cur.team)}${esc(cur.team)} ${cur.n === 1 ? "won the last meeting" : "wins in a row"}</div>`
    : `<div class="hl-value">—</div><div class="hl-sub">Last meeting was a tie</div>`;

  const last = stats.last;
  const lastWinner = stats.side(last);
  const hp = last.homePts ?? "?", ap = last.awayPts ?? "?";
  const lastScore = lastWinner && sameTeam(lastWinner, last.away) ? `${ap}–${hp}` : `${hp}–${ap}`;
  const lastTile = `<div class="hl-value">${esc(lastScore)}</div>
    <div class="hl-sub">${lastWinner ? `${dot(lastWinner)}${esc(lastWinner)}` : "Tie"} · ${esc(fmtDate(last.date))}</div>`;

  const twoRows = (label, fmt) => `<div class="card hl wide"><div class="hl-label">${label}</div><div class="hl-rows">
    ${[team1, team2].map(t => `<div class="hl-row">${dot(t)}<span class="hl-team">${esc(t)}</span>${fmt(t)}</div>`).join("")}
  </div></div>`;

  return `<section class="highlights">
    <div class="card hl"><div class="hl-label">Current streak</div>${curTile}</div>
    <div class="card hl"><div class="hl-label">Last meeting</div>${lastTile}</div>
    ${twoRows("Longest streak", t => {
      const l = stats.longest[t];
      return l ? `<b>${l.n}</b><span class="hl-note">${esc(shortYears(l.from, l.to))}</span>` : `<b>0</b><span class="hl-note"></span>`;
    })}
    ${twoRows("Biggest win", t => {
      const b = stats.biggest[t];
      return b ? `<b>${esc(b.score)}</b><span class="hl-note">${esc(b.season)}</span>` : `<b>—</b><span class="hl-note"></span>`;
    })}
  </section>`;
}

// ---- Record by decade ----

// Mirrored bars: team1's wins grow left from the decade label, team2's grow
// right, on one shared scale. Ties are listed in the hover text.
function decadesHtml(games, team1, team2, c1, c2) {
  const byDecade = new Map();
  for (const g of games) {
    const d = Math.floor(Number(g.season) / 10) * 10;
    if (!byDecade.has(d)) byDecade.set(d, { w1: 0, w2: 0, t: 0 });
    const r = byDecade.get(d);
    if (!g.winner) r.t++;
    else if (sameTeam(g.winner, team1)) r.w1++;
    else if (sameTeam(g.winner, team2)) r.w2++;
  }
  if (byDecade.size < 2) return "";
  const decades = [...byDecade.keys()].sort((a, b) => a - b);
  const max = Math.max(...decades.map(d => Math.max(byDecade.get(d).w1, byDecade.get(d).w2)), 1);
  const rows = decades.map(d => {
    const { w1, w2, t } = byDecade.get(d);
    const tip = `${d}s: ${team1} ${w1}, ${team2} ${w2}${t ? `, ${t} tie${t === 1 ? "" : "s"}` : ""}`;
    return `<div class="dec-row" data-tip="${esc(tip)}" tabindex="0" aria-label="${esc(tip)}">
      <div class="dec-side l"><span class="dec-n${w1 ? "" : " zero"}">${w1}</span>${w1 ? `<i style="width:${(w1 / max) * 100}%;background:${c1}"></i>` : ""}</div>
      <div class="dec-label">${d}s</div>
      <div class="dec-side r">${w2 ? `<i style="width:${(w2 / max) * 100}%;background:${c2}"></i>` : ""}<span class="dec-n${w2 ? "" : " zero"}">${w2}</span></div>
    </div>`;
  }).join("");
  return `<section class="card decades">
    <div class="games-head"><h2 class="section-label">Record by decade</h2></div>
    <div class="dec-legend">
      <span><i style="background:${c1}"></i>${esc(team1)} wins</span>
      <span>${esc(team2)} wins<i style="background:${c2}"></i></span>
    </div>
    <div class="dec-chart">${rows}<div class="chart-tip" hidden></div></div>
  </section>`;
}

// One tooltip per chart, positioned over the hovered (or focused) row.
function initChartTips() {
  const show = row => {
    const chart = row.closest(".dec-chart");
    const tip = chart.querySelector(".chart-tip");
    tip.textContent = row.dataset.tip;
    tip.hidden = false;
    tip.style.top = `${row.offsetTop - tip.offsetHeight - 6}px`;
  };
  const hide = row => { row.closest(".dec-chart").querySelector(".chart-tip").hidden = true; };
  document.addEventListener("mouseover", e => { const r = e.target.closest(".dec-row"); if (r) show(r); });
  document.addEventListener("mouseout", e => { const r = e.target.closest(".dec-row"); if (r && !r.contains(e.relatedTarget)) hide(r); });
  document.addEventListener("focusin", e => { const r = e.target.closest(".dec-row"); if (r) show(r); });
  document.addEventListener("focusout", e => { const r = e.target.closest(".dec-row"); if (r) hide(r); });
}

// ---- Team vs conference ----

function getMode() {
  return document.body.dataset.mode === "conf" ? "conf" : "team";
}

function setMode(mode) {
  document.body.dataset.mode = mode;
  for (const b of document.querySelectorAll(".mode-btn")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  document.getElementById("team2").closest(".input-wrap").hidden = mode === "conf";
  document.getElementById("swap").hidden = mode === "conf";
  document.getElementById("conf-wrap").hidden = mode !== "conf";
}

function fillConferences(index) {
  const sel = document.getElementById("conf");
  const keep = sel.value;
  const names = [...index.conferences.keys()].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = `<option value="">Pick a conference</option>` +
    names.map(n => `<option value="${esc(n)}">${esc(n)} (${index.conferences.get(n).size} teams)</option>`).join("");
  sel.value = keep;
}

// `compare` is the page's compare(), which dispatches on the mode.
function initModes(compare) {
  for (const b of document.querySelectorAll(".mode-btn")) {
    b.addEventListener("click", () => {
      if (getMode() === b.dataset.mode) return;
      setMode(b.dataset.mode);
      document.getElementById("result").innerHTML = "";
      setStatus("");
      clearSuggestions();
    });
  }
  document.getElementById("conf").addEventListener("change", () => {
    if (document.getElementById("team1").value.trim()) compare();
  });
  // Opponent links in the conference table open that head-to-head in place.
  document.addEventListener("click", e => {
    const a = e.target.closest("a.vs-link");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    setMode("team");
    document.getElementById("team1").value = a.dataset.t1;
    document.getElementById("team2").value = a.dataset.t2;
    window.scrollTo({ top: 0, behavior: "smooth" });
    compare();
  });
  setMode("team");
}

// `fetchVsMembers(team, members, onProgress)` is supplied by the page and
// resolves to [{ opponent, wins, losses, ties, games, lastSeason, lastResult }].
async function compareConference(index, fetchVsMembers, compare) {
  const resultEl = document.getElementById("result");
  const input = document.getElementById("team1");
  const go = document.getElementById("go");
  resultEl.innerHTML = "";
  clearSuggestions();

  const raw = input.value.trim();
  const conf = document.getElementById("conf").value;
  if (!raw || !conf) {
    setStatus("Enter a team and pick a conference.", true);
    return;
  }
  if (!index) {
    setStatus("The team list hasn't loaded yet. Try again in a moment.", true);
    return;
  }
  const r = resolveTeam(raw, index);
  if (!r.name) {
    showSuggestions(input, raw, r.suggestions, compare);
    return;
  }
  const team = r.name;
  input.value = team;
  refreshInputLogos(index);
  const note = normalizeName(team) !== normalizeName(raw) ? `Showing ${team} for "${raw}".` : "";
  const members = [...index.conferences.get(conf)].filter(s => s !== team).sort((a, b) => a.localeCompare(b));

  writeConfToUrl(team, conf);
  setStatus(`Loading ${members.length} opponents...`);
  renderSkeleton();
  go.disabled = true;
  try {
    const records = await fetchVsMembers(team, members, done => setStatus(`Loading opponents... ${done} of ${members.length}`));
    setStatus("");
    renderConference({ team, conf, records, note }, index);
  } catch (err) {
    resultEl.innerHTML = "";
    setStatus("Error: " + err.message, true);
  } finally {
    go.disabled = false;
  }
}

// Runs `task` over `items` with at most `limit` in flight, in input order.
async function mapLimit(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const CONF_COLOR = "#8b93a1";

function renderConference({ team, conf, records, note }, index) {
  const m = teamMeta(index, team);
  const c1 = colorDistance(m.color, CONF_COLOR) < 60 && m.altColor && !isNearWhite(m.altColor) ? m.altColor : m.color;
  const sum = k => records.reduce((n, r) => n + r[k], 0);
  const wins = sum("wins"), losses = sum("losses"), ties = sum("ties"), games = sum("games");
  const played = records.filter(r => r.games);
  const pct = wins + losses ? (wins / (wins + losses)) * 100 : null;
  const verdict = pct === null ? `No games vs the ${conf}`
    : wins === losses ? "Even all-time" : wins > losses ? "Winning record" : "Losing record";

  const logos = played.slice().sort((a, b) => b.games - a.games).slice(0, 4)
    .map(r => logoHtml(teamMeta(index, r.opponent), r.opponent, "md")).join("");

  const board = `
    <section class="card scoreboard" style="--c1:${c1};--c2:${CONF_COLOR}">
      <div class="sb-team">${logoHtml(m, team, "lg")}<div class="sb-name">${esc(team)}</div></div>
      <div class="sb-center">
        <div class="sb-nums"><span class="${wins >= losses ? "" : "trail"}">${wins}</span><span class="dash">–</span><span class="${losses >= wins ? "" : "trail"}">${losses}</span></div>
        <div class="sb-verdict">${esc(verdict)}${pct !== null ? ` · ${pct.toFixed(1)}%` : ""}</div>
        ${ties ? `<span class="pill sb-ties">${ties} tie${ties === 1 ? "" : "s"}</span>` : ""}
      </div>
      <div class="sb-team"><div class="conf-logos">${logos}</div><div class="sb-name">vs ${esc(conf)}</div></div>
      ${games ? `<div class="sb-bar" role="img" aria-label="${wins} wins, ${ties} ties, ${losses} losses">
        <i class="b1" style="flex:${wins}"></i><i class="bt" style="flex:${ties}"></i><i class="b2" style="flex:${losses}"></i>
      </div>` : ""}
      <div class="sb-meta"><span>${games} game${games === 1 ? "" : "s"} vs ${played.length} of ${records.length} current members. ${esc(note)}</span><button id="copy-link" class="link-btn" type="button">Copy link</button></div>
    </section>`;

  const sorted = records.slice().sort((a, b) => b.games - a.games || a.opponent.localeCompare(b.opponent));
  const rowHtml = r => {
    const p = r.wins + r.losses ? (r.wins / (r.wins + r.losses)) * 100 : null;
    const rec = `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ""}`;
    return `<tr${r.games ? "" : ' class="upcoming"'}>
      <td><a class="vs-link" href="${esc(matchupHref(team, r.opponent))}" data-t1="${esc(team)}" data-t2="${esc(r.opponent)}">${logoHtml(teamMeta(index, r.opponent), r.opponent, "sm")}<span>${esc(r.opponent)}</span></a></td>
      <td class="score">${r.games ? `<b>${rec}</b>` : "Never played"}</td>
      <td>${p === null ? "—" : `<span class="pct"><span class="pct-bar"><i style="width:${p}%;background:${c1}"></i></span>${p.toFixed(0)}%</span>`}</td>
      <td>${r.games || "—"}</td>
      <td>${r.lastSeason ? `${esc(r.lastSeason)} <span class="pill">${esc(r.lastResult)}</span>` : "—"}</td>
    </tr>`;
  };
  const table = `
    <section class="card games">
      <div class="games-head"><h2 class="section-label">${esc(team)} vs each ${esc(conf)} team</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Opponent</th><th>Record</th><th>Win %</th><th>Games</th><th>Last met</th></tr></thead>
          <tbody>${sorted.map(rowHtml).join("")}</tbody>
        </table>
      </div>
      <p class="table-note">Records are against the conference's current members, including games from before they joined. Tap a team for the full head-to-head.</p>
    </section>`;

  document.getElementById("result").innerHTML = board + table;
}


// ---- Shareable links ----

function readTeamsFromUrl() {
  const params = new URLSearchParams(location.search);
  const t1 = (params.get("t1") || "").trim();
  const t2 = (params.get("t2") || "").trim();
  const conf = (params.get("conf") || "").trim();
  if (t1 && conf) return { t1, conf };
  return t1 && t2 ? { t1, t2 } : null;
}

// replaceState, so repeated compares don't fill the Back-button history.
function writeTeamsToUrl(t1, t2) {
  const params = new URLSearchParams({ t1, t2 });
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

function writeConfToUrl(t1, conf) {
  const params = new URLSearchParams({ t1, conf });
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

function matchupHref(t1, t2) {
  return "?" + new URLSearchParams({ t1, t2 });
}

function autoRunFromUrl(compare) {
  const teams = readTeamsFromUrl();
  if (!teams) return;
  document.getElementById("team1").value = teams.t1;
  if (teams.conf) {
    setMode("conf");
    document.getElementById("conf").value = teams.conf;
  } else {
    setMode("team");
    document.getElementById("team2").value = teams.t2;
  }
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
      setMode("team");
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
