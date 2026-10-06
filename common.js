// Shared by cfb-h2h.html and cbb-h2h.html: team-name resolution (aliases and
// typos), shareable ?t1=&t2= links, the swap button and the copy-link button.
// Expects each page to define setStatus() and to have #team1, #team2, #swap,
// #suggest, #copy-link and #result elements.

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

// Maps normalized names to canonical school names. `aliasFields` are extra
// fields on each team (strings or arrays of strings) such as abbreviations.
function buildTeamIndex(teams, aliasFields) {
  const bySchool = new Map();
  const byAlias = new Map();
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
  }
  return { bySchool, byAlias, schools: [...new Set(bySchool.values())] };
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
  return { t1: names[0], t2: names[1], note: notes.length ? ` Showing ${notes.join(" and ")}.` : "" };
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

function autoRunFromUrl(compare) {
  const teams = readTeamsFromUrl();
  if (!teams) return;
  document.getElementById("team1").value = teams.t1;
  document.getElementById("team2").value = teams.t2;
  compare();
}

function showCopyLink(show) {
  document.getElementById("copy-link").hidden = !show;
}

function initCopyLink() {
  const btn = document.getElementById("copy-link");
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = "Copied!";
    } catch {
      btn.textContent = "Copy failed. Use the address bar.";
    }
    setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
  });
}

// ---- Swap ----

function initSwap(compare) {
  document.getElementById("swap").addEventListener("click", () => {
    const a = document.getElementById("team1");
    const b = document.getElementById("team2");
    [a.value, b.value] = [b.value, a.value];
    if (document.getElementById("result").children.length) compare();
  });
}
