// Shared by cfb-h2h.html and cbb-h2h.html: team-name resolution (aliases and
// typos), team colors and logos, the score bug, series notes, decade chart and
// game list, shareable ?t1=&t2= links, the swap button and the loading skeleton.
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
    chip.className = "chip slant";
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

// WCAG relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Text on a team-colored block: white, unless the color is light (e.g. Carolina blue).
// Block text is large and bold, so 3:1 is enough.
function textOn(hex) {
  return contrast(hex, "#ffffff") >= 3 ? "#ffffff" : "#10141b";
}

function mix(hex, other, t) {
  const a = hexToRgb(hex), b = hexToRgb(other);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

// Page backgrounds from style.css (--bg), light and dark.
const LIGHT_BG = "#ffffff";
const DARK_BG = "#0d1117";

// Colors for bars, card stripes and dots drawn on the page background. A team
// color that nearly vanishes there (navy on the dark background) is swapped for
// its alternate color, else blended toward white (dark) or black (light). Team 2
// then takes the first option that stays distinct from team 1.
function markPair(bg, [c1, alt1], [c2, alt2]) {
  const toward = bg === DARK_BG ? "#ffffff" : "#000000";
  const options = (c, alt) => [c, alt && !isNearWhite(alt) ? alt : null, mix(c, toward, 0.5), alt]
    .filter(x => x && contrast(x, bg) >= 2);
  const o1 = options(c1, alt1), o2 = options(c2, alt2);
  const m1 = o1[0] || c1;
  const m2 = o2.find(x => colorDistance(x, m1) >= 90) || o2[0] || c2;
  return [m1, m2];
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
// The "disc" size sits on a white circle, so it always uses the light-mode logo.
function logoHtml(meta, name, size) {
  const dark = meta.logoDark && size !== "disc"
    ? `<source media="(prefers-color-scheme: dark)" srcset="${esc(meta.logoDark)}">` : "";
  const img = meta.logo
    ? `<picture>${dark}<img src="${esc(meta.logo)}" alt="" loading="lazy" onerror="this.closest('.logo').classList.add('no-img')"></picture>`
    : "";
  return `<span class="logo ${size}${meta.logo ? "" : " no-img"}" style="--team:${meta.color}" aria-hidden="true">${img}<span class="initials">${esc(initials(name, meta.abbr))}</span></span>`;
}

// Small logo inside each input, and the team's color on its left edge, once it
// names a known team.
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
    if (name) wrap.style.setProperty("--team", teamMeta(index, name).color);
    else wrap.style.removeProperty("--team");
  }
}

function initInputLogos(getIndex) {
  for (const id of ["team1", "team2"]) {
    const input = document.getElementById(id);
    for (const ev of ["change", "blur", "input"]) input.addEventListener(ev, () => refreshInputLogos(getIndex()));
  }
}

// ---- Results ----

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function capHtml(text) {
  return `<h2 class="cap"><span>${esc(text)}</span></h2>`;
}

function renderSkeleton() {
  document.getElementById("result").innerHTML = `
    <div class="skeleton" aria-hidden="true">
      <div class="skel-row"><div class="skel"></div><div class="skel"></div></div>
      <div class="skel strip"></div>
    </div>`;
}

const numClass = n => (Number(n) >= 100 ? "bug-num long" : "bug-num");

// The score bug: two team blocks with a middle block, over an accent strip.
// `left`/`right` are { logo, name, num }; `mid` is [label, value]; `strip` is a list of phrases.
function bugHtml({ left, right, mid, strip, summary }) {
  const parts = strip.filter(Boolean).map(s => `<span>${esc(s)}</span>`).join(`<span class="sep" aria-hidden="true">/</span>`);
  return `
    <section class="bug">
      <h2 class="sr-only">${esc(summary)}</h2>
      <div class="bug-row" aria-hidden="true">
        <div class="bug-team t1">${left.logo}<div class="bug-name">${esc(left.name)}</div><div class="${numClass(left.num)}">${esc(left.num)}</div></div>
        <div class="bug-mid"><small>${esc(mid[0])}</small><b>${esc(mid[1])}</b></div>
        <div class="bug-team t2"><div class="${numClass(right.num)}">${esc(right.num)}</div><div class="bug-name">${esc(right.name)}</div>${right.logo}</div>
      </div>
      <div class="bug-strip">${parts}<button id="copy-link" class="link-btn" type="button">Copy link</button></div>
    </section>`;
}

// Sets the CSS variables the result is drawn with: block colors, text on them,
// and the page-background mark colors for light and dark mode.
function colorVars(c1, alt1, c2, alt2) {
  const [l1, l2] = markPair(LIGHT_BG, [c1, alt1], [c2, alt2]);
  const [d1, d2] = markPair(DARK_BG, [c1, alt1], [c2, alt2]);
  return `--c1:${c1};--c2:${c2};--f1:${textOn(c1)};--f2:${textOn(c2)};--m1:${l1};--m2:${l2};--m1d:${d1};--m2d:${d2}`;
}

// `rows` are normalized games, newest first:
// { date, season, site, badges: [], home, away, homePts, awayPts, winner (name or null), upcoming }
function renderMatchup({ team1, team2, wins1, wins2, ties, note, rows }, index) {
  const m1 = teamMeta(index, team1);
  const m2 = teamMeta(index, team2);
  const [c1, c2] = matchupColors(m1, m2, team2);
  const ab = [initials(team1, m1.abbr), initials(team2, m2.abbr)];

  const stats = seriesStats(rows, team1, team2);
  const played = stats.games;
  const upcoming = rows.filter(g => g.upcoming).sort((a, b) => new Date(a.date) - new Date(b.date));
  const seasons = played.map(g => Number(g.season));
  const first = seasons.length ? Math.min(...seasons) : null;
  const lastSeason = seasons.length ? Math.max(...seasons) : null;

  const leader = !played.length ? "No games played yet"
    : wins1 === wins2 ? "Series tied"
    : `${wins1 > wins2 ? team1 : team2} leads series`;
  const last = stats.last;
  const lastWinner = last && stats.side(last);
  const lastLine = !last ? null
    : `Last: ${lastWinner ? ab[sameTeam(lastWinner, team1) ? 0 : 1] : "Tie"} ${winnerFirstScore(last, lastWinner)}`;
  const mid = ties ? ["All-time", `${ties} T`]
    : first ? ["Since", first]
    : ["Next", upcoming[0] ? fmtDate(upcoming[0].date) : "—"];

  const board = bugHtml({
    left: { logo: logoHtml(m1, team1, "disc"), name: team1, num: wins1 },
    right: { logo: logoHtml(m2, team2, "disc"), name: team2, num: wins2 },
    mid,
    strip: [
      leader,
      played.length ? plural(played.length, "meeting") : null,
      first ? (first === lastSeason ? `${first}` : `${first}–${lastSeason}`) : null,
      lastLine,
      upcoming[0] ? `Next: ${fmtDate(upcoming[0].date)}` : null,
    ],
    summary: `${team1} ${wins1}, ${team2} ${wins2}${ties ? `, ${plural(ties, "tie")}` : ""}`,
  });

  document.getElementById("result").innerHTML = `
    <div class="matchup" style="${colorVars(c1, m1.altColor, c2, m2.altColor)}">
      <div>${board}${note ? `<p class="bug-note">${esc(note)}</p>` : ""}</div>
      ${highlightsHtml(stats, team1, team2, ab)}
      ${decadesHtml(played, team1, team2)}
      ${gamesHtml(rows, team1, team2, played.length)}
    </div>`;
}

// "27–9": the winner's score first.
function winnerFirstScore(g, winner) {
  const hp = g.homePts ?? "?", ap = g.awayPts ?? "?";
  return winner && sameTeam(winner, g.away) ? `${ap}–${hp}` : `${hp}–${ap}`;
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

// Six cards, three across: current streak, last meeting, then longest streak
// and biggest win for each team. Each card's top stripe is the team it's about.
function highlightsHtml(stats, team1, team2, ab) {
  if (!stats.games.length) return "";
  const markOf = t => (!t ? "var(--line)" : sameTeam(t, team1) ? "var(--mark1)" : "var(--mark2)");
  const abOf = t => (sameTeam(t, team1) ? ab[0] : ab[1]);
  const shortYears = (a, b) => (a === b ? `${a}` : `${a}–${String(b).slice(String(a).slice(0, 2) === String(b).slice(0, 2) ? 2 : 0)}`);
  const card = (label, value, sub, team) => `
    <div class="note" style="--mark:${markOf(team)}">
      <span class="note-label">${esc(label)}</span>
      <span class="note-value">${esc(value)}</span>
      <span class="note-sub">${esc(sub)}</span>
    </div>`;

  const cur = stats.current;
  const last = stats.last;
  const lastWinner = stats.side(last);
  const cards = [
    cur ? card("Current streak", `${abOf(cur.team)} ${cur.n}`, cur.n === 1 ? `${cur.team} won the last meeting` : `${cur.team} wins in a row`, cur.team)
      : card("Current streak", "—", "Last meeting was a tie", null),
    card("Last meeting", winnerFirstScore(last, lastWinner), `${lastWinner || "Tie"} · ${fmtDate(last.date)}`, lastWinner),
  ];
  for (const [i, t] of [team1, team2].entries()) {
    const l = stats.longest[t];
    cards.push(card(`Longest streak · ${ab[i]}`, l ? l.n : 0, l ? shortYears(l.from, l.to) : "No wins yet", t));
  }
  for (const [i, t] of [team1, team2].entries()) {
    const b = stats.biggest[t];
    cards.push(card(`Biggest win · ${ab[i]}`, b ? b.score : "—", b ? `${b.season}` : "No wins yet", t));
  }
  return `<section class="section">${capHtml("Series notes")}<div class="notes">${cards.join("")}</div></section>`;
}

// ---- Wins by decade ----

// One column per decade: team1's wins rise above the decade label, team2's hang
// below it, on one shared scale. Ties are printed under the decade.
function decadesHtml(games, team1, team2) {
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
  const anyTies = decades.some(d => byDecade.get(d).t);
  const bar = n => (n ? `<i style="height:${Math.round((n / max) * 110)}px"></i>` : "");
  const cols = decades.map(d => {
    const { w1, w2, t } = byDecade.get(d);
    const label = `${d}s: ${team1} ${w1}, ${team2} ${w2}${t ? `, ${plural(t, "tie")}` : ""}`;
    return `<div class="dec-col" role="img" aria-label="${esc(label)}">
      <div class="dec-up"><span class="dec-n">${w1 || ""}</span>${bar(w1)}</div>
      <div class="dec-label">${d}s${t ? `<small>${t} T</small>` : ""}</div>
      <div class="dec-down">${bar(w2)}<span class="dec-n">${w2 || ""}</span></div>
    </div>`;
  }).join("");
  return `<section class="section">
    <div class="section-head">
      ${capHtml("Wins by decade")}
      <div class="dec-legend">
        <span><i style="background:var(--mark1)"></i>${esc(team1)}, above the line</span>
        <span><i style="background:var(--mark2)"></i>${esc(team2)}, below</span>
      </div>
    </div>
    <div class="dec-scroll"><div class="dec-chart${anyTies ? " has-ties" : ""}" style="min-width:${decades.length * 40}px">${cols}</div></div>
  </section>`;
}

// ---- Every meeting ----

const BOX_COUNT = 6;

// The newest six games (upcoming ones first) as score boxes, plus a button that
// opens a table of every game.
function gamesHtml(rows, team1, team2, playedCount) {
  const ptsFor = (g, t) => (sameTeam(g.home, t) ? g.homePts : g.awayPts);
  const badgesHtml = g => (g.badges || []).map(b => `<span class="pill${b.post ? " post" : ""}">${esc(b.text)}</span>`).join(" ");

  const box = g => {
    const line = (t, mark) => {
      const won = !g.upcoming && g.winner && sameTeam(g.winner, t);
      return `<div class="box-line${won ? " won" : ""}"><span>${esc(t)}</span><b>${g.upcoming ? "–" : esc(ptsFor(g, t) ?? "?")}</b></div>`;
    };
    const tags = badgesHtml(g);
    return `<div class="box${g.upcoming ? " upcoming" : ""}">
      <div class="box-head"><span>${g.upcoming ? "Upcoming" : "Final"} · ${esc(fmtDate(g.date))}</span><span class="box-site">${esc(g.site || "")}</span></div>
      ${line(team1)}${line(team2)}
      ${tags ? `<div class="box-tags">${tags}</div>` : ""}
    </div>`;
  };

  const markOf = name => (sameTeam(name, team1) ? "var(--mark1)" : sameTeam(name, team2) ? "var(--mark2)" : "var(--line)");
  const rowHtml = g => {
    const homeWon = !g.upcoming && g.winner && sameTeam(g.winner, g.home);
    const awayWon = !g.upcoming && g.winner && sameTeam(g.winner, g.away);
    const score = g.upcoming ? "–"
      : `${homeWon ? `<b>${esc(g.homePts)}</b>` : esc(g.homePts ?? "?")}–${awayWon ? `<b>${esc(g.awayPts)}</b>` : esc(g.awayPts ?? "?")}`;
    const winnerCell = g.upcoming ? "Upcoming"
      : g.winner ? `<span class="dot" style="background:${markOf(g.winner)}"></span>${esc(g.winner)}`
      : `<span class="dot"></span>Tie`;
    return `<tr${g.upcoming ? ' class="upcoming"' : ""}>
      <td>${esc(fmtDate(g.date))}</td>
      <td class="team${homeWon ? " won" : ""}">${esc(g.home)}</td>
      <td class="team${awayWon ? " won" : ""}">${esc(g.away)}</td>
      <td class="score">${score}</td>
      <td>${winnerCell}</td>
      <td>${badgesHtml(g)}</td>
    </tr>`;
  };

  const upcomingCount = rows.length - playedCount;
  const allLabel = `All ${plural(playedCount, "meeting")}${upcomingCount ? ` + ${upcomingCount} upcoming` : ""}`;
  const more = rows.length > BOX_COUNT;
  return `<section class="section">
    ${capHtml("Every meeting")}
    <div class="boxes">${rows.slice(0, BOX_COUNT).map(box).join("")}</div>
    ${more ? `
      <button type="button" class="btn slant" data-games="show" aria-expanded="false" aria-controls="full-games">${esc(allLabel)}</button>
      <div class="full-games" id="full-games" hidden>
        <div class="full-games-head">
          <h3>${esc(allLabel)}</h3>
          <button type="button" class="btn quiet slant" data-games="hide">Hide full list</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Home</th><th>Away</th><th class="num">Score</th><th>Winner</th><th>Note</th></tr></thead>
            <tbody>${rows.map(rowHtml).join("")}</tbody>
          </table>
        </div>
      </div>` : ""}
  </section>`;
}

// Results are re-rendered on every compare, so listen at the document level.
function initGamesToggle() {
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-games]");
    if (!btn) return;
    const section = btn.closest(".section");
    const show = section.querySelector('[data-games="show"]');
    const full = section.querySelector(".full-games");
    const open = btn.dataset.games === "show";
    full.hidden = !open;
    show.hidden = open;
    show.setAttribute("aria-expanded", String(open));
    (open ? full.querySelector('[data-games="hide"]') : show).focus();
  });
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

// The conference side of the score bug: slate, with white text.
const CONF_COLOR = "#5b6472";

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

  const board = bugHtml({
    left: { logo: logoHtml(m, team, "disc"), name: team, num: wins },
    right: { logo: `<div class="conf-logos">${logos}</div>`, name: `vs ${conf}`, num: losses },
    mid: ["Win %", pct === null ? "—" : `${pct.toFixed(0)}%`],
    strip: [
      verdict,
      `${plural(games, "game")} vs ${played.length} of ${records.length} members`,
      ties ? plural(ties, "tie") : null,
    ],
    summary: `${team} vs the ${conf}: ${wins} wins, ${losses} losses${ties ? `, ${plural(ties, "tie")}` : ""}`,
  });

  const sorted = records.slice().sort((a, b) => b.games - a.games || a.opponent.localeCompare(b.opponent));
  const rowHtml = r => {
    const p = r.wins + r.losses ? (r.wins / (r.wins + r.losses)) * 100 : null;
    const rec = `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ""}`;
    return `<tr${r.games ? "" : ' class="upcoming"'}>
      <td><a class="vs-link" href="${esc(matchupHref(team, r.opponent))}" data-t1="${esc(team)}" data-t2="${esc(r.opponent)}">${logoHtml(teamMeta(index, r.opponent), r.opponent, "sm")}<span>${esc(r.opponent)}</span></a></td>
      <td class="score">${r.games ? `<b>${rec}</b>` : "Never played"}</td>
      <td>${p === null ? "—" : `<span class="pct"><span class="pct-bar"><i style="width:${p}%"></i></span>${p.toFixed(0)}%</span>`}</td>
      <td>${r.games || "—"}</td>
      <td>${r.lastSeason ? `${esc(r.lastSeason)} <span class="pill">${esc(r.lastResult)}</span>` : "—"}</td>
    </tr>`;
  };
  const table = `
    <section class="section">
      ${capHtml(`${team} vs each ${conf} team`)}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Opponent</th><th class="num">Record</th><th>Win %</th><th>Games</th><th>Last met</th></tr></thead>
          <tbody>${sorted.map(rowHtml).join("")}</tbody>
        </table>
      </div>
      <p class="table-note">Records are against the conference's current members, including games from before they joined. Tap a team for the full head-to-head.</p>
    </section>`;

  document.getElementById("result").innerHTML = `
    <div class="matchup" style="${colorVars(c1, m.altColor, CONF_COLOR, null)}">
      <div>${board}${note ? `<p class="bug-note">${esc(note)}</p>` : ""}</div>
      ${table}
    </div>`;
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
    chip.className = "chip slant";
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
  // The page heading also shrinks to screen-reader only while a result is showing.
  const sync = () => {
    box.hidden = result.children.length > 0;
    document.body.classList.toggle("has-result", result.children.length > 0);
  };
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
    if (document.querySelector("#result .bug")) compare();
  });
}
