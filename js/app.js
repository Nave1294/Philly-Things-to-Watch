// Main UI logic for Philly Things to Watch.

const CATEGORIES = [
  "Transportation",
  "Development",
  "Parks & Public Space",
  "Trials & Legal",
  "Politics",
  "Sports & Stadiums",
  "Events",
  "Other",
];

const STATUSES = [
  "Proposed",
  "Planning",
  "Approved",
  "In Progress",
  "On Hold",
  "Completed",
  "Cancelled",
];

// Category glyphs — small typographic marks differentiate categories
// without introducing new colors. All share the accent tint.
const CAT_GLYPHS = {
  "Transportation": "→",
  "Development": "▣",
  "Parks & Public Space": "❀",
  "Trials & Legal": "§",
  "Politics": "¶",
  "Sports & Stadiums": "◉",
  "Events": "✦",
  "Other": "·",
};

const state = {
  projects: [],
  activeCategories: new Set(CATEGORIES),
  activeStatuses: new Set(STATUSES),
  search: "",
  sort: "updated-desc",
  view: "timeline",
  map: null,
  mapMarkers: [],
};

// ---------- Utilities ----------
function $(id) { return document.getElementById(id); }
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function relativeTime(d) {
  if (!d) return "";
  const ms = Date.now() - new Date(d).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function toast(message, kind = "") {
  const t = $("toast");
  t.textContent = message;
  t.className = `toast ${kind}`;
  t.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add("hidden"), 3500);
}

// ---------- Filter chips ----------
function renderFilterChips() {
  const catWrap = $("category-filters");
  const statusWrap = $("status-filters");
  catWrap.innerHTML = "";
  statusWrap.innerHTML = "";
  for (const c of CATEGORIES) {
    catWrap.append(el("div", {
      class: state.activeCategories.has(c) ? "chip active" : "chip",
      onclick: () => toggleSet(state.activeCategories, c, renderFilterChips),
    }, c));
  }
  for (const s of STATUSES) {
    statusWrap.append(el("div", {
      class: state.activeStatuses.has(s) ? "chip active" : "chip",
      onclick: () => toggleSet(state.activeStatuses, s, renderFilterChips),
    }, s));
  }
  renderTimeline();
}

function toggleSet(set, val, cb) {
  if (set.has(val)) set.delete(val); else set.add(val);
  cb();
}

// ---------- Timeline rendering ----------
function filteredProjects() {
  const q = state.search.toLowerCase().trim();
  let list = state.projects.filter((p) =>
    state.activeCategories.has(p.category) &&
    state.activeStatuses.has(p.status) &&
    (!q || p.title.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q) || (p.location || "").toLowerCase().includes(q))
  );
  switch (state.sort) {
    case "updated-desc":
      list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      break;
    case "created-desc":
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case "created-asc":
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;
    case "completion-asc":
      list.sort((a, b) => {
        if (!a.completionDate) return 1;
        if (!b.completionDate) return -1;
        return new Date(a.completionDate) - new Date(b.completionDate);
      });
      break;
    case "status":
      list.sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status));
      break;
  }
  return list;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PX_PER_DAY = 3;            // 3px/day ≈ 90px/month — ~12 months in a 1080px viewport
const LABEL_WIDTH = 240;
const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 44;

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}
function dateToX(date, start) {
  const days = (new Date(date).getTime() - start.getTime()) / DAY_MS;
  return days * PX_PER_DAY;
}

function renderTimeline() {
  const wrap = $("timeline-view");
  const list = filteredProjects();
  wrap.innerHTML = "";
  $("empty-state").classList.toggle("hidden", state.projects.length !== 0);
  if (state.projects.length === 0) return;

  if (list.length === 0) {
    wrap.append(el("p", { class: "muted", style: "text-align:center;padding:2rem" },
      "No projects match the current filters."));
    return;
  }

  // Compute the time range across all phases.
  const now = new Date();
  const allDates = [];
  for (const p of list) {
    for (const ph of getProjectPhases(p)) {
      const t = new Date(ph.date).getTime();
      if (Number.isFinite(t)) allDates.push(t);
    }
  }
  let minTs = allDates.length ? Math.min(...allDates) : now.getTime() - 90 * DAY_MS;
  let maxTs = allDates.length ? Math.max(...allDates) : now.getTime() + 365 * DAY_MS;
  // Always include "today" plus 2 months of padding on each side.
  minTs = Math.min(minTs, now.getTime() - 60 * DAY_MS);
  maxTs = Math.max(maxTs, now.getTime() + 60 * DAY_MS);
  const start = startOfMonth(new Date(minTs - 30 * DAY_MS));
  const endRaw = new Date(maxTs + 30 * DAY_MS);
  const end = startOfMonth(addMonths(endRaw, 1));
  const totalDays = (end.getTime() - start.getTime()) / DAY_MS;
  const totalWidth = Math.max(totalDays * PX_PER_DAY, 1080);

  const gantt = el("div", { class: "gantt" });

  // ---------- Header (month / year scale) ----------
  const header = el("div", { class: "gantt-header" });
  header.append(el("div", { class: "gantt-corner" },
    el("span", { class: "muted small" }, "project")));
  const scale = el("div", { class: "gantt-scale", style: `width:${totalWidth}px` });

  let m = new Date(start);
  let lastYear = null;
  while (m < end) {
    const x = dateToX(m, start);
    const monthWidth = ((addMonths(m, 1) - m) / DAY_MS) * PX_PER_DAY;
    const yearLabel = m.getFullYear() !== lastYear;
    lastYear = m.getFullYear();
    scale.append(el("div", {
      class: "gantt-month",
      style: `left:${x}px;width:${monthWidth}px`,
    },
      yearLabel ? el("div", { class: "gantt-year-label" }, String(m.getFullYear())) : null,
      el("div", { class: "gantt-month-label" },
        m.toLocaleDateString(undefined, { month: "short" })),
    ));
    m = addMonths(m, 1);
  }
  header.append(scale);
  gantt.append(header);

  // ---------- Rows ----------
  const todayX = dateToX(now, start);
  const rows = el("div", { class: "gantt-rows" });
  for (const p of list) {
    const phases = getProjectPhases(p);
    const row = el("div", {
      class: "gantt-row",
      dataset: { status: p.status },
    });
    const label = el("div", {
      class: "gantt-label",
      onclick: () => openDetail(p.id),
    },
      el("h3", { class: "gantt-label-title" }, p.title),
      statusBadge(p.status),
    );
    row.append(label);

    const track = el("div", { class: "gantt-track", style: `width:${totalWidth}px` });

    // Month grid lines on the track
    let mm = new Date(start);
    while (mm < end) {
      const x = dateToX(mm, start);
      track.append(el("div", { class: "gantt-gridline", style: `left:${x}px` }));
      mm = addMonths(mm, 1);
    }

    // Today line
    if (todayX >= 0 && todayX <= totalWidth) {
      track.append(el("div", { class: "gantt-today", style: `left:${todayX}px` }));
    }

    // Connecting line between first and last phase
    if (phases.length >= 2) {
      const firstX = dateToX(phases[0].date, start);
      const lastX = dateToX(phases[phases.length - 1].date, start);
      track.append(el("div", {
        class: "gantt-phase-line",
        style: `left:${firstX}px;width:${Math.max(0, lastX - firstX)}px`,
      }));
    }

    // Phase dots
    for (const ph of phases) {
      const x = dateToX(ph.date, start);
      const isPast = new Date(ph.date).getTime() <= now.getTime();
      const dot = el("div", {
        class: `gantt-phase ${isPast ? "past" : "future"}`,
        style: `left:${x}px`,
        title: `${ph.name} · ${formatDate(ph.date)}`,
        onclick: (ev) => { ev.stopPropagation(); openDetail(p.id); },
      },
        el("span", { class: "gantt-phase-dot" }),
        el("span", { class: "gantt-phase-label" }, ph.name),
      );
      track.append(dot);
    }

    if (phases.length === 0) {
      track.append(el("div", { class: "gantt-no-dates", style: `left:${todayX + 12}px` },
        "no dates set — click to add"));
      track.style.cursor = "pointer";
      track.onclick = () => openEdit(p.id);
    }

    row.append(track);
    rows.append(row);
  }
  gantt.append(rows);

  wrap.append(gantt);

  // Scroll so "today" sits about a quarter from the left on first render
  setTimeout(() => {
    const target = todayX - 150;
    gantt.scrollLeft = Math.max(0, target);
  }, 0);

  if (state.view === "map") renderMap();
}

// Badge factories
function categoryBadge(cat) {
  return el("span", { class: "badge badge-cat" },
    el("span", { class: "cat-glyph" }, CAT_GLYPHS[cat] || "·"),
    cat,
  );
}
function statusBadge(status) {
  return el("span", { class: "badge badge-status", dataset: { status } }, status);
}

// ---------- Detail modal ----------
async function openDetail(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  const body = $("project-detail-body");
  body.innerHTML = "";

  body.append(
    el("div", { class: "detail-header" },
      el("h2", { class: "detail-title" }, p.title),
      el("div", { class: "card-meta" }, categoryBadge(p.category), statusBadge(p.status)),
      el("div", { class: "detail-actions" },
        el("button", { onclick: () => { closeModal("project-detail-modal"); openEdit(p.id); } }, "edit"),
        PTW_Claude.isConfigured()
          ? el("button", { onclick: () => manualRefreshProject(p.id), title: "Ask Claude to re-check this project right now" }, "✦ refresh now")
          : null,
        el("a", { href: p.url, target: "_blank" },
          el("button", {}, "view on github")),
      ),
      p.lastAutoRefresh
        ? el("p", { class: "muted small", style: "text-align:center;margin-top:0.5rem;font-style:italic" },
            `last auto-refreshed ${relativeTime(p.lastAutoRefresh)}`)
        : null,
    ),
    p.description ? el("div", { class: "detail-section" },
      el("h3", {}, "Description"),
      el("p", {}, p.description),
    ) : null,
    el("div", { class: "detail-section" },
      el("h3", {}, "Details"),
      el("div", { class: "detail-meta-grid" },
        metaTile("Location", p.location || "—"),
        metaTile("Created", formatDate(p.createdAt)),
        metaTile("Last update", relativeTime(p.updatedAt)),
      ),
    ),
  );

  // Phases section
  const phases = getProjectPhases(p);
  if (phases.length) {
    const today = Date.now();
    const phaseList = el("ol", { class: "phase-list" });
    for (const ph of phases) {
      const isPast = new Date(ph.date).getTime() <= today;
      phaseList.append(el("li", { class: `phase-list-item ${isPast ? "past" : "future"}` },
        el("span", { class: "phase-list-dot" }),
        el("span", { class: "phase-list-date" }, formatDate(ph.date)),
        el("span", { class: "phase-list-name" }, ph.name),
      ));
    }
    body.append(el("div", { class: "detail-section" },
      el("h3", {}, "Phases"),
      phaseList,
    ));
  }

  if (p.links && p.links.length) {
    const ul = el("ul", { class: "links-list" });
    for (const link of p.links) {
      ul.append(el("li", {},
        el("a", { href: link, target: "_blank" }, link)));
    }
    body.append(el("div", { class: "detail-section" },
      el("h3", {}, "Links"), ul));
  }

  // Updates section — auto-generated by the bi-weekly Claude refresh.
  const updatesSection = el("div", { class: "detail-section" },
    el("h3", {}, "Updates"),
    el("p", { class: "muted small", style: "text-align:center;margin:-0.5rem 0 0.75rem;font-style:italic" },
      "auto-generated by Claude every two weeks"),
    el("ul", { class: "update-list", id: "updates-list" },
      el("li", { class: "muted" }, "Loading updates...")),
  );
  body.append(updatesSection);

  // News section
  const newsSection = el("div", { class: "detail-section" },
    el("h3", {}, "Latest News"),
    el("ul", { class: "news-list", id: "news-list" },
      el("li", { class: "muted" }, "Fetching news...")),
  );
  body.append(newsSection);

  openModal("project-detail-modal");

  // Load updates and news in parallel.
  PTW.listUpdates(id).then(renderUpdates).catch((e) => {
    $("updates-list").innerHTML = `<li class="muted">Could not load updates: ${escapeHtml(e.message)}</li>`;
  });
  PTW_News.fetchNews(p).then(renderNews).catch((e) => {
    $("news-list").innerHTML = `<li class="muted">No news available right now.</li>`;
  });
}

function metaTile(label, value) {
  return el("div", {},
    el("label", {}, label),
    el("span", {}, value),
  );
}

function renderUpdates(updates) {
  const list = $("updates-list");
  if (!list) return;
  list.innerHTML = "";
  if (!updates.length) {
    list.append(el("li", { class: "muted" }, "No updates yet. Add the first one below."));
    return;
  }
  for (const u of updates.slice().reverse()) {
    list.append(el("li", { class: "update-item" },
      el("div", { class: "update-meta" }, `${formatDate(u.createdAt)} • ${u.author}`),
      el("div", {}, u.body),
    ));
  }
}

function renderNews(items) {
  const list = $("news-list");
  if (!list) return;
  list.innerHTML = "";
  if (!items.length) {
    list.append(el("li", { class: "muted" },
      "No news found. Add specific search terms to the project to improve results."));
    return;
  }
  for (const n of items) {
    list.append(el("li", { class: "news-item" },
      el("div", { class: "news-meta" }, `${n.source} • ${formatDate(n.publishedAt)}`),
      el("a", { href: n.link, target: "_blank" }, n.title),
      n.snippet ? el("div", { class: "muted small", style: "margin-top:0.25rem" }, n.snippet) : null,
    ));
  }
}

// ---------- Add / Edit project ----------
function openAdd() {
  $("project-form-title").textContent = "Add Project";
  $("project-id").value = "";
  $("project-form").reset();
  $("autofill-status").textContent = "";
  $("autofill-status").className = "autofill-status muted small";
  $("delete-project").classList.add("hidden");
  refreshAutofillButton();
  openModal("project-form-modal");
}

function openEdit(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  $("project-form-title").textContent = "Edit Project";
  $("autofill-status").textContent = "";
  $("autofill-status").className = "autofill-status muted small";
  refreshAutofillButton();
  $("project-id").value = p.id;
  $("project-name").value = p.title;
  $("project-category").value = p.category;
  $("project-status").value = p.status;
  $("project-description").value = p.description || "";
  $("project-start").value = p.startDate ? p.startDate.slice(0, 10) : "";
  $("project-completion").value = p.completionDate ? p.completionDate.slice(0, 10) : "";
  $("project-location").value = p.location || "";
  $("project-search-terms").value = p.searchTerms || "";
  $("project-links").value = (p.links || []).join("\n");
  $("project-phases").value = serializePhases(p.phases);
  $("delete-project").classList.remove("hidden");
  openModal("project-form-modal");
}

// ---------- Phases parsing ----------
function parsePhases(text) {
  if (!text) return [];
  return text.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Accept "YYYY-MM-DD: Name" or "YYYY-MM-DD - Name" or "YYYY-MM: Name"
      const m = line.match(/^(\d{4}-\d{2}(?:-\d{2})?)\s*[:\-–]\s*(.+)$/);
      if (!m) return null;
      let date = m[1];
      if (date.length === 7) date += "-01";
      return { date, name: m[2].trim() };
    })
    .filter(Boolean);
}
function serializePhases(phases) {
  if (!Array.isArray(phases)) return "";
  return phases
    .filter((p) => p && p.date && p.name)
    .map((p) => `${p.date}: ${p.name}`)
    .join("\n");
}

function getProjectPhases(project) {
  if (Array.isArray(project.phases) && project.phases.length) {
    return project.phases
      .filter((ph) => ph && ph.date && ph.name)
      .slice()
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  }
  // Fall back to startDate/completionDate so legacy projects still render.
  const fallback = [];
  if (project.startDate) fallback.push({ name: "Started", date: project.startDate });
  if (project.completionDate) fallback.push({ name: "Completion", date: project.completionDate });
  return fallback;
}

async function handleSaveProject(e) {
  e.preventDefault();
  const id = $("project-id").value;
  const payload = {
    title: $("project-name").value.trim(),
    category: $("project-category").value,
    status: $("project-status").value,
    description: $("project-description").value.trim(),
    startDate: $("project-start").value,
    completionDate: $("project-completion").value,
    location: $("project-location").value.trim(),
    searchTerms: $("project-search-terms").value.trim(),
    links: $("project-links").value.split("\n").map((s) => s.trim()).filter(Boolean),
    phases: parsePhases($("project-phases").value),
  };
  try {
    if (id) {
      await PTW.updateProject(Number(id), payload);
      toast("Project updated", "success");
    } else {
      await PTW.createProject(payload);
      toast("Project added", "success");
    }
    closeModal("project-form-modal");
    await reloadProjects();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function handleDeleteProject() {
  const id = $("project-id").value;
  if (!id) return;
  if (!confirm("Remove this project from the timeline? The underlying GitHub issue will be closed but kept for history.")) return;
  try {
    await PTW.deleteProject(Number(id));
    toast("Project removed", "success");
    closeModal("project-form-modal");
    await reloadProjects();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- Map view ----------
const NEIGHBORHOOD_COORDS = {
  "center city": [39.9526, -75.1652],
  "fishtown": [39.9706, -75.1303],
  "northern liberties": [39.9656, -75.1378],
  "old city": [39.9519, -75.1437],
  "south philly": [39.9203, -75.1656],
  "south philadelphia": [39.9203, -75.1656],
  "west philadelphia": [39.9528, -75.2057],
  "west philly": [39.9528, -75.2057],
  "university city": [39.9522, -75.1932],
  "north philadelphia": [39.9925, -75.1452],
  "north philly": [39.9925, -75.1452],
  "kensington": [39.9842, -75.1278],
  "port richmond": [39.9856, -75.1095],
  "manayunk": [40.0270, -75.2207],
  "roxborough": [40.0381, -75.2261],
  "germantown": [40.0397, -75.1730],
  "chestnut hill": [40.0747, -75.2090],
  "mount airy": [40.0625, -75.1842],
  "graduate hospital": [39.9419, -75.1810],
  "rittenhouse": [39.9495, -75.1719],
  "rittenhouse square": [39.9495, -75.1719],
  "fairmount": [39.9683, -75.1714],
  "brewerytown": [39.9789, -75.1819],
  "passyunk": [39.9281, -75.1714],
  "east passyunk": [39.9281, -75.1714],
  "point breeze": [39.9344, -75.1808],
  "queen village": [39.9381, -75.1486],
  "bella vista": [39.9395, -75.1573],
  "society hill": [39.9436, -75.1486],
  "spring garden": [39.9628, -75.1593],
  "logan square": [39.9572, -75.1739],
  "navy yard": [39.8901, -75.1697],
  "south street": [39.9419, -75.1503],
  "olde kensington": [39.9747, -75.1392],
  "francisville": [39.9686, -75.1633],
  "strawberry mansion": [39.9933, -75.1817],
  "powelton village": [39.9598, -75.1942],
  "mantua": [39.9655, -75.1942],
};

const PHILLY_CENTER = [39.9526, -75.1652];
const GEO_CACHE_PREFIX = "ptw_geo_";

function jitter() { return (Math.random() - 0.5) * 0.004; }

// Synchronous geocode: returns coords instantly when the location is
// either a known neighborhood or already cached. Returns null otherwise
// (caller should fall back to async geocoding).
function geocodeSync(loc) {
  if (!loc) return null;
  const cached = localStorage.getItem(GEO_CACHE_PREFIX + loc);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }
  const key = loc.toLowerCase().trim();
  for (const [name, coords] of Object.entries(NEIGHBORHOOD_COORDS)) {
    if (key.includes(name)) {
      const result = [coords[0] + jitter(), coords[1] + jitter()];
      localStorage.setItem(GEO_CACHE_PREFIX + loc, JSON.stringify(result));
      return result;
    }
  }
  return null;
}

// Async geocode via Nominatim (OpenStreetMap). Free, no key, rate-limited
// to 1 req/sec per their usage policy. We cache aggressively so each
// unique location string is fetched at most once, ever.
async function geocodeAsync(loc) {
  if (!loc) return null;
  const cached = geocodeSync(loc);
  if (cached) return cached;
  const query = `${loc}, Philadelphia, PA`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.length) return null;
    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const result = [lat, lon];
    localStorage.setItem(GEO_CACHE_PREFIX + loc, JSON.stringify(result));
    return result;
  } catch (err) {
    console.warn("Nominatim geocode failed for", loc, err);
    return null;
  }
}

// Sequential queue so we respect Nominatim's 1 req/sec rate limit.
const geocodeQueue = (() => {
  let chain = Promise.resolve();
  return (loc) => {
    chain = chain.then(async () => {
      const result = await geocodeAsync(loc);
      await new Promise((r) => setTimeout(r, 1100));
      return result;
    });
    return chain;
  };
})();

function ensureMap() {
  if (state.map) return state.map;
  state.map = L.map("map", { zoomControl: true, attributionControl: true }).setView(PHILLY_CENTER, 12);
  // CartoDB Positron — minimal light tiles. CSS filter warms them to the cream palette.
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: "© OpenStreetMap, © CARTO",
  }).addTo(state.map);
  return state.map;
}

function addMapMarker(map, project, coords) {
  const stClass =
    project.status === "Completed" ? "completed"
    : project.status === "Cancelled" ? "cancelled"
    : "";
  const icon = L.divIcon({
    className: "ptw-marker",
    html: `<div class="ptw-marker-dot ${stClass}"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  const marker = L.marker(coords, { icon });
  marker.bindPopup(
    `<strong>${escapeHtml(project.title)}</strong><br>` +
    `<em style="font-size:0.85em;color:var(--text-dim)">${escapeHtml(project.category)} · ${escapeHtml(project.status)}</em><br>` +
    `<a href="#" data-id="${project.id}" class="map-detail-link">view details →</a>`
  );
  marker.on("popupopen", (e) => {
    const link = e.popup.getElement().querySelector(".map-detail-link");
    if (link) link.addEventListener("click", (ev) => { ev.preventDefault(); openDetail(project.id); });
  });
  marker.addTo(map);
  state.mapMarkers.push(marker);
}

function renderMap() {
  const map = ensureMap();
  for (const m of state.mapMarkers) map.removeLayer(m);
  state.mapMarkers = [];
  state.mapRenderGen = (state.mapRenderGen || 0) + 1;
  const gen = state.mapRenderGen;

  const list = filteredProjects();
  for (const p of list) {
    if (!p.location) continue;
    const cached = geocodeSync(p.location);
    if (cached) {
      addMapMarker(map, p, cached);
    } else {
      geocodeQueue(p.location).then((coords) => {
        // Discard if a newer render has started since we queued this.
        if (coords && state.view === "map" && state.mapRenderGen === gen) {
          addMapMarker(map, p, coords);
        }
      });
    }
  }
  setTimeout(() => map.invalidateSize(), 50);
}

// ---------- Settings modal ----------
function openSettings() {
  $("repo-input").value = PTW.getRepo();
  $("token-input").value = PTW.getToken();
  $("claude-input").value = PTW_Claude.getKey();
  openModal("settings-modal");
}

async function saveSettings() {
  const repo = $("repo-input").value.trim();
  const token = $("token-input").value.trim();
  const claudeKey = $("claude-input").value.trim();
  if (!repo.match(/^[\w.-]+\/[\w.-]+$/)) {
    toast("Repository must be in the form owner/repo", "error");
    return;
  }
  if (!token) {
    toast("Token is required", "error");
    return;
  }
  PTW.setRepo(repo);
  PTW.setToken(token);
  if (claudeKey) PTW_Claude.setKey(claudeKey);
  try {
    await PTW.verifyAccess();
    toast("Settings saved", "success");
    closeModal("settings-modal");
    refreshAutofillButton();
    await reloadProjects();
  } catch (err) {
    toast(`Could not access repo: ${err.message}`, "error");
  }
}

function clearSettings() {
  if (!confirm("Clear your GitHub token, repo, and Claude key from this browser?")) return;
  PTW.clear();
  PTW_Claude.clear();
  $("repo-input").value = "";
  $("token-input").value = "";
  $("claude-input").value = "";
  state.projects = [];
  renderTimeline();
  refreshAutofillButton();
  toast("Settings cleared");
}

// ---------- Auto-fill ----------
function refreshAutofillButton() {
  const btn = $("autofill-btn");
  if (!btn) return;
  if (PTW_Claude.isConfigured()) {
    btn.disabled = false;
    btn.title = "Look up this project and pre-fill the form";
  } else {
    btn.disabled = true;
    btn.title = "Add an Anthropic API key in Settings to enable auto-fill";
  }
}

async function handleAutofill() {
  const name = $("project-name").value.trim();
  const status = $("autofill-status");
  if (!name) {
    status.textContent = "Type a project name first.";
    status.className = "autofill-status error";
    return;
  }
  if (!PTW_Claude.isConfigured()) {
    status.textContent = "Add an Anthropic API key in Settings first.";
    status.className = "autofill-status error";
    return;
  }
  const btn = $("autofill-btn");
  btn.classList.add("loading");
  btn.textContent = "✦ searching…";
  status.textContent = "Asking Claude to look this up…";
  status.className = "autofill-status";

  try {
    const data = await PTW_Claude.lookupProject(name);

    // If there's a clarifying question, ask the user before applying.
    if (data.clarifyingQuestion && data.confidence !== "high") {
      const ok = confirm(
        `Claude suggests: "${data.confirmedName}"\n\n` +
        `${data.clarifyingQuestion}\n\n` +
        `Apply these suggestions anyway?`
      );
      if (!ok) {
        status.textContent = "Cancelled — try a more specific name.";
        status.className = "autofill-status";
        return;
      }
    }

    applyAutofill(data);
    status.textContent = `Filled in from Claude (confidence: ${data.confidence || "unknown"}). Review and edit anything that looks off.`;
    status.className = "autofill-status success";
  } catch (err) {
    status.textContent = err.message;
    status.className = "autofill-status error";
  } finally {
    btn.classList.remove("loading");
    btn.textContent = "✦ auto-fill";
  }
}

function applyAutofill(data) {
  if (data.confirmedName) $("project-name").value = data.confirmedName;
  if (data.category && CATEGORIES.includes(data.category)) $("project-category").value = data.category;
  if (data.status && STATUSES.includes(data.status)) $("project-status").value = data.status;
  if (data.description) $("project-description").value = data.description;
  if (data.startDate) $("project-start").value = data.startDate;
  if (data.completionDate) $("project-completion").value = data.completionDate;
  if (data.location) $("project-location").value = data.location;
  if (data.searchTerms) $("project-search-terms").value = data.searchTerms;
  if (Array.isArray(data.links) && data.links.length) {
    $("project-links").value = data.links.join("\n");
  }
  if (Array.isArray(data.phases) && data.phases.length) {
    const cleaned = data.phases.filter((ph) => ph && ph.date && ph.name);
    $("project-phases").value = serializePhases(cleaned);
  }
}

// ---------- Bi-weekly auto-refresh ----------
// Every two weeks when the user visits, silently ask Claude to re-check each
// active project. Every refresh writes a new entry to the project's update
// feed (current status + summary + recent sources) so the user gets a regular
// pulse without typing anything. Completed and Cancelled projects are skipped.

const REFRESH_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days (bi-weekly)
const REFRESH_GAP_MS = 4000; // gentle pacing between API calls

function isStale(project) {
  if (!project.lastAutoRefresh) return true;
  const last = new Date(project.lastAutoRefresh).getTime();
  if (!last) return true;
  return Date.now() - last > REFRESH_INTERVAL_MS;
}

function isActive(project) {
  return project.status !== "Completed" && project.status !== "Cancelled";
}

function setBanner(text, kind = "") {
  const banner = $("refresh-banner");
  const textEl = $("refresh-banner-text");
  textEl.textContent = text;
  banner.className = `refresh-banner ${kind}`;
  banner.classList.remove("hidden");
}

function hideBanner() {
  $("refresh-banner").classList.add("hidden");
}

async function maybeRunWeeklyRefresh() {
  if (!PTW.isConfigured() || !PTW_Claude.isConfigured()) return;
  if (state.refreshing) return;

  const stale = state.projects.filter((p) => isActive(p) && isStale(p));
  if (stale.length === 0) return;

  state.refreshing = true;
  setBanner(`checking ${stale.length} project${stale.length === 1 ? "" : "s"} for updates…`, "refreshing");

  const changes = [];
  let checked = 0;
  for (const project of stale) {
    checked += 1;
    setBanner(`checking ${checked} of ${stale.length}: ${project.title}…`, "refreshing");
    try {
      const result = await refreshSingleProject(project);
      if (result && result.changed) changes.push(result);
    } catch (err) {
      console.warn(`Refresh failed for ${project.title}:`, err);
    }
    if (checked < stale.length) {
      await sleep(REFRESH_GAP_MS);
    }
  }

  state.refreshing = false;
  if (changes.length === 0) {
    setBanner(`checked ${stale.length} project${stale.length === 1 ? "" : "s"} — nothing has shifted.`, "done");
  } else {
    const summary = changes
      .map((c) => c.statusChanged ? `${c.title}: ${c.fromStatus} → ${c.toStatus}` : c.title)
      .join(" · ");
    setBanner(`logged updates for ${changes.length} project${changes.length === 1 ? "" : "s"} — ${summary}`, "done");
    await reloadProjects();
  }
  setTimeout(hideBanner, 20000);
}

async function refreshSingleProject(project) {
  const data = await PTW_Claude.lookupProject(project.title);
  const today = new Date().toISOString().slice(0, 10);

  const newStatus = STATUSES.includes(data.status) ? data.status : project.status;
  const statusChanged = newStatus !== project.status;

  // Merge Claude's phases with existing ones — if Claude returns new dated
  // phases, adopt them; otherwise keep what the user already had so manual
  // edits aren't blown away by auto-refresh.
  const mergedPhases = Array.isArray(data.phases) && data.phases.length
    ? data.phases.filter((ph) => ph && ph.date && ph.name)
    : project.phases || [];

  const payload = {
    title: project.title,
    category: project.category,
    status: newStatus,
    description: project.description,
    startDate: project.startDate,
    completionDate: project.completionDate,
    location: project.location,
    searchTerms: project.searchTerms,
    links: project.links,
    phases: mergedPhases,
    lastAutoRefresh: today,
  };

  await PTW.updateProject(project.id, payload);

  // Always write a fresh update entry so the user has a regular pulse
  // — not just when status changes.
  const headline = statusChanged
    ? `Status changed from **${project.status}** → **${newStatus}**.`
    : `Status: **${newStatus}** (unchanged).`;
  const comment =
    `**Auto-update · ${today}**\n\n` +
    headline + "\n\n" +
    (data.description ? `${data.description}\n\n` : "") +
    (Array.isArray(data.links) && data.links.length
      ? `Sources:\n${data.links.map((l) => `- ${l}`).join("\n")}`
      : "");
  try {
    await PTW.addUpdate(project.id, comment);
  } catch (e) {
    console.warn("Could not add auto-update comment:", e);
  }
  return {
    changed: true,
    statusChanged,
    title: project.title,
    fromStatus: project.status,
    toStatus: newStatus,
  };
}

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

async function manualRefreshProject(id) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;
  if (!PTW_Claude.isConfigured()) {
    toast("Add an Anthropic API key in Settings to use refresh", "error");
    return;
  }
  toast(`Checking ${project.title}…`);
  try {
    const result = await refreshSingleProject(project);
    if (result.changed) {
      toast(`Status: ${result.fromStatus} → ${result.toStatus}`, "success");
    } else {
      toast("Nothing has shifted.", "success");
    }
    await reloadProjects();
    // Reopen the detail view so the user sees the fresh info.
    openDetail(id);
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- Modal helpers ----------
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }

// ---------- View switching ----------
function setView(v) {
  state.view = v;
  $("view-timeline").classList.toggle("active", v === "timeline");
  $("view-map").classList.toggle("active", v === "map");
  $("timeline-view").classList.toggle("hidden", v !== "timeline");
  $("map-view").classList.toggle("hidden", v !== "map");
  if (v === "map") renderMap();
}

// ---------- Data loading ----------
async function reloadProjects() {
  if (!PTW.isConfigured()) {
    $("loading").classList.add("hidden");
    $("empty-state").classList.remove("hidden");
    $("empty-state").innerHTML = `
      <h2>Welcome to Philly Things to Watch</h2>
      <p>Click <strong>⚙ Settings</strong> in the top-right to connect your GitHub repo so we can start tracking projects.</p>
    `;
    return;
  }
  $("loading").classList.remove("hidden");
  try {
    state.projects = await PTW.listProjects();
    renderTimeline();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    $("loading").classList.add("hidden");
  }
}

async function loadAndMaybeRefresh() {
  await reloadProjects();
  // Run the weekly check in the background so it doesn't block initial render.
  maybeRunWeeklyRefresh();
}

// ---------- Wire up event listeners ----------
function init() {
  // Pre-fill repo with GitHub Pages host if reasonable.
  if (!PTW.getRepo() && location.hostname.endsWith("github.io")) {
    const parts = location.hostname.split(".");
    const owner = parts[0];
    const repoSegments = location.pathname.split("/").filter(Boolean);
    if (owner && repoSegments[0]) {
      // Best-guess default; user can override in Settings.
      $("repo-input").value = `${owner}/${repoSegments[0]}`;
    }
  }

  $("settings-btn").addEventListener("click", openSettings);
  $("save-settings").addEventListener("click", saveSettings);
  $("clear-settings").addEventListener("click", clearSettings);
  $("add-project-btn").addEventListener("click", () => {
    if (!PTW.isConfigured()) { openSettings(); return; }
    openAdd();
  });
  $("project-form").addEventListener("submit", handleSaveProject);
  $("delete-project").addEventListener("click", handleDeleteProject);
  $("autofill-btn").addEventListener("click", handleAutofill);
  refreshAutofillButton();
  $("view-timeline").addEventListener("click", () => setView("timeline"));
  $("view-map").addEventListener("click", () => setView("map"));

  $("search").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderTimeline();
  });
  $("sort-select").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderTimeline();
  });

  // Generic close button handling.
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  // Click outside modal to close.
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target === m) m.classList.add("hidden");
    });
  });
  $("refresh-banner-close").addEventListener("click", hideBanner);

  renderFilterChips();
  loadAndMaybeRefresh();
}

document.addEventListener("DOMContentLoaded", init);
