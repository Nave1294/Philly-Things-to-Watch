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

function renderTimeline() {
  const wrap = $("timeline-view");
  const list = filteredProjects();
  wrap.innerHTML = "";
  $("empty-state").classList.toggle("hidden", state.projects.length !== 0);
  renderProjectList();
  if (state.projects.length === 0) return;

  if (list.length === 0) {
    wrap.append(el("p", { class: "muted", style: "text-align:center;padding:2rem" },
      "No projects match the current filters."));
    return;
  }

  const events = [];
  for (const project of list) {
    for (const ph of getProjectPhases(project)) {
      const t = new Date(ph.date).getTime();
      if (Number.isFinite(t)) events.push({ project, phase: ph, ts: t });
    }
  }
  events.sort((a, b) => a.ts - b.ts);

  if (events.length === 0) {
    wrap.append(el("p", { class: "muted", style: "text-align:center;padding:2rem" },
      "No dated phases yet. Add phases to your projects to see the timeline."));
    return;
  }

  const now = Date.now();

  // ---------- Density-aware horizontal positioning ----------
  const MIN_GAP = 230;
  const MAX_GAP = 360;
  const PX_PER_YEAR = 240;
  const CALLOUT_W = 180;
  const CALLOUT_HALF = CALLOUT_W / 2;
  const EDGE_PAD = CALLOUT_HALF + 70;  // generous so callouts never hug the viewing-box edge
  const LANE_STEP = 150;
  const BASE_STEM = 70;

  // Insert "today" as a virtual event so the today marker has a slot.
  const enriched = events.map((e) => ({ ...e, isPast: e.ts <= now }));

  // Compute x-positions
  let cursor = EDGE_PAD;
  for (let i = 0; i < enriched.length; i++) {
    if (i > 0) {
      const dtDays = (enriched[i].ts - enriched[i - 1].ts) / DAY_MS;
      const yearBonus = Math.min(dtDays, 365 * 3) / 365 * PX_PER_YEAR;
      const gap = Math.max(MIN_GAP, Math.min(MAX_GAP, MIN_GAP + yearBonus));
      cursor += gap;
    }
    enriched[i].x = cursor;
  }
  const totalWidth = Math.max(cursor + EDGE_PAD, 1100);

  // Today's x: interpolate between the events that bracket it.
  let todayX;
  if (now <= enriched[0].ts) todayX = Math.max(20, enriched[0].x - MIN_GAP / 2);
  else if (now >= enriched[enriched.length - 1].ts) todayX = Math.min(totalWidth - 20, enriched[enriched.length - 1].x + MIN_GAP / 2);
  else {
    for (let i = 1; i < enriched.length; i++) {
      if (enriched[i].ts >= now) {
        const prev = enriched[i - 1];
        const curr = enriched[i];
        const t = (now - prev.ts) / (curr.ts - prev.ts);
        todayX = prev.x + t * (curr.x - prev.x);
        break;
      }
    }
  }

  // Year markers: positioned at the leftmost event in each year, so the
  // label sits at the *start* of the year's span rather than its centroid.
  // (A centroid drifts right when later events in the year exist, which made
  // "2026" appear to the right of today even though today is May.)
  const eventsByYear = new Map();
  for (const ev of enriched) {
    const yr = new Date(ev.ts).getFullYear();
    if (!eventsByYear.has(yr)) eventsByYear.set(yr, []);
    eventsByYear.get(yr).push(ev.x);
  }
  const yearMarkers = [...eventsByYear.entries()].map(([yr, xs]) => ({
    year: yr,
    x: Math.min(...xs),
  }));

  // ---------- Lane-pack callouts ----------
  // Each lane stores the [left, right] range of every placed callout. To put
  // an event in lane i we need (a) no horizontal overlap with anything else
  // in that lane and (b) the event's stem at x must not pass straight through
  // a callout sitting in any lower lane (those callouts are between the
  // stem's tip and the axis).
  const aboveLanes = [];
  const belowLanes = [];
  const STEM_PAD = 6;
  function placeInLane(x, lanes) {
    const leftEdge = x - CALLOUT_HALF - 12;
    const rightEdge = x + CALLOUT_HALF + 12;
    for (let i = 0; i < lanes.length; i++) {
      const sameLaneClash = lanes[i].some(([l, r]) =>
        !(rightEdge <= l || leftEdge >= r)
      );
      if (sameLaneClash) continue;
      let stemThroughLower = false;
      for (let j = 0; j < i; j++) {
        if (lanes[j].some(([l, r]) => x > l - STEM_PAD && x < r + STEM_PAD)) {
          stemThroughLower = true;
          break;
        }
      }
      if (stemThroughLower) continue;
      lanes[i].push([x - CALLOUT_HALF, x + CALLOUT_HALF]);
      return i;
    }
    lanes.push([[x - CALLOUT_HALF, x + CALLOUT_HALF]]);
    return lanes.length - 1;
  }
  for (let i = 0; i < enriched.length; i++) {
    enriched[i].above = i % 2 === 0;
    enriched[i].lane = placeInLane(enriched[i].x, enriched[i].above ? aboveLanes : belowLanes);
  }

  const maxAbove = Math.max(aboveLanes.length, 1);
  const maxBelow = Math.max(belowLanes.length, 1);
  const aboveHeight = BASE_STEM + maxAbove * LANE_STEP;
  const belowHeight = BASE_STEM + maxBelow * LANE_STEP;
  const yearsHeight = 36;
  const axisHeight = 36;

  // ---------- Render ----------
  const tl = el("div", { class: "tl" });
  const content = el("div", {
    class: "tl-content",
    style: `width:${totalWidth}px;height:${aboveHeight + yearsHeight + axisHeight + belowHeight}px`,
  });

  const above = el("div", { class: "tl-above", style: `height:${aboveHeight}px` });
  const yearsRow = el("div", { class: "tl-years", style: `height:${yearsHeight}px` });
  const axis = el("div", { class: "tl-axis", style: `height:${axisHeight}px` });
  axis.append(el("div", { class: "tl-axis-line" }));
  const below = el("div", { class: "tl-below", style: `height:${belowHeight}px` });

  // Year labels (in their own row, no overlap with dots)
  for (const ym of yearMarkers) {
    yearsRow.append(el("div", { class: "tl-year", style: `left:${ym.x}px` }, String(ym.year)));
  }

  // Today marker — a bullseye dot sitting on the axis, with a label
  // tucked beneath. No vertical line cutting through the rest of the chart.
  if (todayX !== undefined) {
    axis.append(el("div", {
      class: "tl-today",
      style: `left:${todayX}px`,
      title: "today",
    },
      el("div", { class: "tl-today-ring" }),
      el("div", { class: "tl-today-core" }),
    ));
    axis.append(el("div", {
      class: "tl-today-label",
      style: `left:${todayX}px`,
    }, "today"));
  }

  for (const ev of enriched) {
    const sideEl = ev.above ? above : below;
    const stemHeight = BASE_STEM + ev.lane * LANE_STEP;

    // Stem: from axis center toward callout
    sideEl.append(el("div", {
      class: "tl-stem",
      style: ev.above
        ? `left:${ev.x}px;bottom:0;height:${stemHeight - 8}px`
        : `left:${ev.x}px;top:0;height:${stemHeight - 8}px`,
    }));

    // Callout
    const calloutStyle = ev.above
      ? `left:${ev.x}px;bottom:${stemHeight}px;width:${CALLOUT_W}px`
      : `left:${ev.x}px;top:${stemHeight}px;width:${CALLOUT_W}px`;
    sideEl.append(el("div", {
      class: `tl-callout ${ev.isPast ? "past" : "future"}`,
      style: calloutStyle,
      onclick: () => openDetail(ev.project.id),
      dataset: { status: ev.project.status },
    },
      el("div", { class: "tl-callout-project" }, ev.project.title),
      el("div", { class: "tl-callout-phase" }, ev.phase.name),
      el("div", { class: "tl-callout-date" }, formatDate(ev.phase.date)),
    ));

    // Dot
    axis.append(el("div", {
      class: `tl-dot ${ev.isPast ? "past" : "future"}`,
      style: `left:${ev.x}px`,
      title: `${ev.project.title} · ${ev.phase.name} · ${formatDate(ev.phase.date)}`,
      onclick: () => openDetail(ev.project.id),
      dataset: { status: ev.project.status },
    }));
  }

  content.append(above, yearsRow, axis, below);
  tl.append(content);
  wrap.append(tl);

  setTimeout(() => {
    if (todayX !== undefined) tl.scrollLeft = Math.max(0, todayX - 280);
  }, 0);

  if (state.view === "map") renderMap();
}

function renderProjectList() {
  const wrap = $("project-list");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (state.projects.length === 0) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  const sorted = state.projects.slice().sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
  );
  wrap.append(el("h2", { class: "project-list-title" }, "All tracked projects"));
  const ul = el("ul", { class: "project-list-ul" });
  for (const p of sorted) {
    ul.append(el("li", { class: "project-list-item", onclick: () => openDetail(p.id) },
      el("span", { class: "project-list-name" }, p.title),
      statusBadge(p.status),
    ));
  }
  wrap.append(ul);
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
  const idRaw = $("project-id").value;
  const id = idRaw ? Number(idRaw) : null;
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
  // Preserve lastAutoRefresh if editing an existing project
  if (id) {
    const existing = state.projects.find((p) => p.id === id);
    if (existing) payload.lastAutoRefresh = existing.lastAutoRefresh || "";
  }

  const submitBtn = e.target?.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "saving…"; }

  try {
    let saved;
    if (id) {
      saved = await PTW.updateProject(id, payload);
      // Replace in local state immediately so the UI reflects the save
      // without waiting for the next listProjects fetch (which can lag
      // due to GitHub API eventual consistency).
      const idx = state.projects.findIndex((p) => p.id === id);
      if (idx >= 0) state.projects[idx] = saved;
      toast("Project updated", "success");
    } else {
      saved = await PTW.createProject(payload);
      state.projects.push(saved);
      toast("Project added", "success");
    }
    closeModal("project-form-modal");
    renderTimeline();
    // Background reconcile against the API in case anything diverged.
    setTimeout(() => reloadProjects(), 1500);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save Project"; }
  }
}

async function handleDeleteProject() {
  const id = Number($("project-id").value);
  if (!id) return;
  if (!confirm("Permanently remove this project from the timeline?")) return;
  const btn = $("delete-project");
  btn.disabled = true;
  btn.textContent = "deleting…";
  try {
    await PTW.deleteProject(id);
    // Optimistically drop from local state so it disappears immediately.
    state.projects = state.projects.filter((p) => p.id !== id);
    toast("Project removed", "success");
    closeModal("project-form-modal");
    renderTimeline();
    setTimeout(() => reloadProjects(), 1500);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Delete";
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
// Bumped from ptw_geo_ so previously-cached imprecise neighborhood
// hits get re-resolved against Nominatim.
const GEO_CACHE_PREFIX = "ptw_geo2_";

function jitter() { return (Math.random() - 0.5) * 0.004; }

function geocodeSync(loc) {
  if (!loc) return null;
  const cached = localStorage.getItem(GEO_CACHE_PREFIX + loc);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }
  return null;
}

// Async geocode: try Nominatim first for the most specific match. If
// it returns nothing, fall back to the hardcoded neighborhood map.
// If even that fails, drop a jittered marker near Philly center so the
// project appears on the map approximately. Cached forever per loc.
async function geocodeAsync(loc) {
  if (!loc) return null;
  const cached = geocodeSync(loc);
  if (cached) return cached;

  // 1. Nominatim — most precise
  try {
    const query = `${loc}, Philadelphia, PA`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.length) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          const result = [lat, lon];
          localStorage.setItem(GEO_CACHE_PREFIX + loc, JSON.stringify(result));
          return result;
        }
      }
    }
  } catch (err) {
    console.warn("Nominatim failed for", loc, err);
  }

  // 2. Hardcoded neighborhood map — coarse but covers common cases
  const key = loc.toLowerCase().trim();
  for (const [name, coords] of Object.entries(NEIGHBORHOOD_COORDS)) {
    if (key.includes(name)) {
      const result = [coords[0] + jitter(), coords[1] + jitter()];
      localStorage.setItem(GEO_CACHE_PREFIX + loc, JSON.stringify(result));
      return result;
    }
  }

  // 3. Approximate: Philly center with bigger jitter so it doesn't
  //    pile up exactly on top of other unknowns.
  const result = [
    PHILLY_CENTER[0] + jitter() * 4,
    PHILLY_CENTER[1] + jitter() * 4,
  ];
  localStorage.setItem(GEO_CACHE_PREFIX + loc, JSON.stringify(result));
  return result;
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

async function clearAllProjects() {
  if (!PTW.isConfigured()) {
    toast("Configure your repo and token first", "error");
    return;
  }
  if (!confirm("Delete all projects from the timeline?\n\nThis closes every tracked GitHub issue and removes the tracking label. The issues remain in your repo but disappear from this site. You can re-add projects after.")) return;
  if (!confirm("Are you sure? This cannot be undone from the site.")) return;

  const btn = $("clear-projects");
  btn.disabled = true;
  const original = btn.textContent;

  // Re-fetch from the API in case local state is stale, so we
  // actually wipe every tracked issue (not just whatever is rendered).
  let projects = state.projects;
  try {
    projects = await PTW.listProjects();
  } catch (err) {
    toast(`Could not list projects: ${err.message}`, "error");
    btn.disabled = false;
    btn.textContent = original;
    return;
  }

  let removed = 0;
  for (const p of projects) {
    btn.textContent = `deleting ${removed + 1} of ${projects.length}…`;
    try {
      await PTW.deleteProject(p.id);
      removed += 1;
    } catch (err) {
      console.warn(`Could not delete ${p.title}:`, err);
    }
  }

  state.projects = [];
  renderTimeline();
  btn.textContent = original;
  btn.disabled = false;
  closeModal("settings-modal");
  toast(`Removed ${removed} project${removed === 1 ? "" : "s"}.`, "success");
  setTimeout(() => reloadProjects(), 1500);
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
  const data = await PTW_Claude.refreshProject(project);
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
  $("clear-projects").addEventListener("click", clearAllProjects);
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
