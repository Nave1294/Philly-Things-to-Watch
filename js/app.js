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

const CAT_COLORS = {
  "Transportation": "var(--cat-transportation)",
  "Development": "var(--cat-development)",
  "Parks & Public Space": "var(--cat-parks)",
  "Trials & Legal": "var(--cat-trials)",
  "Politics": "var(--cat-politics)",
  "Sports & Stadiums": "var(--cat-sports)",
  "Events": "var(--cat-events)",
  "Other": "var(--cat-other)",
};

const STATUS_COLORS = {
  "Proposed": "var(--st-proposed)",
  "Planning": "var(--st-planning)",
  "Approved": "var(--st-approved)",
  "In Progress": "var(--st-inprogress)",
  "On Hold": "var(--st-onhold)",
  "Completed": "var(--st-completed)",
  "Cancelled": "var(--st-cancelled)",
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
    const chip = el("div", {
      class: state.activeCategories.has(c) ? "chip active" : "chip",
      onclick: () => toggleSet(state.activeCategories, c, renderFilterChips),
    }, c);
    if (state.activeCategories.has(c)) chip.style.background = CAT_COLORS[c];
    catWrap.append(chip);
  }
  for (const s of STATUSES) {
    const chip = el("div", {
      class: state.activeStatuses.has(s) ? "chip active" : "chip",
      onclick: () => toggleSet(state.activeStatuses, s, renderFilterChips),
    }, s);
    if (state.activeStatuses.has(s)) chip.style.background = STATUS_COLORS[s];
    statusWrap.append(chip);
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

function renderTimeline() {
  const wrap = $("timeline-view");
  const list = filteredProjects();
  wrap.innerHTML = "";
  $("empty-state").classList.toggle("hidden", state.projects.length !== 0);
  if (state.projects.length === 0) return;

  if (list.length === 0) {
    wrap.append(el("p", { class: "muted", style: "text-align:center;padding:2rem" },
      "No projects match the current filters."));
  }

  for (const p of list) {
    const card = el("div", {
      class: "project-card",
      dataset: { status: p.status, id: p.id },
      onclick: () => openDetail(p.id),
    });
    const catColor = CAT_COLORS[p.category] || "var(--cat-other)";
    const stColor = STATUS_COLORS[p.status] || "var(--st-proposed)";

    card.append(
      el("div", { class: "card-header" },
        el("h3", { class: "card-title" }, p.title),
      ),
      el("div", { class: "card-meta" },
        el("span", { class: "badge badge-cat", style: `color:${catColor};background:${catColor}22;` }, p.category),
        el("span", { class: "badge badge-status", style: `color:${stColor};` }, p.status),
      ),
      p.description ? el("p", { class: "card-desc" }, p.description) : null,
      el("div", { class: "card-footer" },
        el("span", { class: "card-location" }, p.location || "—"),
        p.completionDate ? el("span", { class: "card-completion" }, `Target: ${formatDate(p.completionDate)}`) : null,
        el("span", { class: "updated" }, `Updated ${relativeTime(p.updatedAt)}`),
      ),
    );
    // Tint the timeline dot to match category.
    card.style.setProperty("--accent", catColor);
    wrap.append(card);
  }
  if (state.view === "map") renderMap();
}

// ---------- Detail modal ----------
async function openDetail(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  const body = $("project-detail-body");
  body.innerHTML = "";

  const catColor = CAT_COLORS[p.category] || "var(--cat-other)";
  const stColor = STATUS_COLORS[p.status] || "var(--st-proposed)";

  body.append(
    el("div", { class: "detail-header" },
      el("div", {},
        el("h2", { class: "detail-title" }, p.title),
        el("div", { class: "card-meta" },
          el("span", { class: "badge badge-cat", style: `color:${catColor};background:${catColor}22;` }, p.category),
          el("span", { class: "badge badge-status", style: `color:${stColor};` }, p.status),
        ),
      ),
      el("div", { class: "detail-actions" },
        el("button", { onclick: () => { closeModal("project-detail-modal"); openEdit(p.id); } }, "Edit"),
        el("a", { href: p.url, target: "_blank", style: "display:inline-block" },
          el("button", {}, "View on GitHub")),
      ),
    ),
    p.description ? el("div", { class: "detail-section" },
      el("h3", {}, "Description"),
      el("p", {}, p.description),
    ) : null,
    el("div", { class: "detail-section" },
      el("h3", {}, "Details"),
      el("div", { class: "detail-meta-grid" },
        metaTile("Start", formatDate(p.startDate) || "—"),
        metaTile("Target completion", formatDate(p.completionDate) || "—"),
        metaTile("Location", p.location || "—"),
        metaTile("Created", formatDate(p.createdAt)),
        metaTile("Last update", relativeTime(p.updatedAt)),
      ),
    ),
  );

  if (p.links && p.links.length) {
    const ul = el("ul", { class: "links-list" });
    for (const link of p.links) {
      ul.append(el("li", {},
        el("a", { href: link, target: "_blank" }, link)));
    }
    body.append(el("div", { class: "detail-section" },
      el("h3", {}, "Links"), ul));
  }

  // Updates section
  const updatesSection = el("div", { class: "detail-section" },
    el("h3", {}, `Updates (${p.commentCount || 0})`),
    el("ul", { class: "update-list", id: "updates-list" },
      el("li", { class: "muted" }, "Loading updates...")),
    el("form", { class: "update-form", onsubmit: (e) => handleAddUpdate(e, p.id) },
      el("input", { type: "text", id: "update-input", placeholder: "Add an update (e.g. May 11 — construction paused due to permits)", required: true }),
      el("button", { type: "submit", class: "primary" }, "Add"),
    ),
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

async function handleAddUpdate(e, id) {
  e.preventDefault();
  const input = $("update-input");
  const body = input.value.trim();
  if (!body) return;
  try {
    await PTW.addUpdate(id, body);
    input.value = "";
    toast("Update added", "success");
    const updates = await PTW.listUpdates(id);
    renderUpdates(updates);
    await reloadProjects();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------- Add / Edit project ----------
function openAdd() {
  $("project-form-title").textContent = "Add Project";
  $("project-id").value = "";
  $("project-form").reset();
  $("delete-project").classList.add("hidden");
  openModal("project-form-modal");
}

function openEdit(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  $("project-form-title").textContent = "Edit Project";
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
  $("delete-project").classList.remove("hidden");
  openModal("project-form-modal");
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

function geocodeLocation(loc) {
  if (!loc) return null;
  const key = loc.toLowerCase().trim();
  for (const [name, coords] of Object.entries(NEIGHBORHOOD_COORDS)) {
    if (key.includes(name)) {
      // Tiny jitter so overlapping projects don't stack invisibly.
      const jitter = () => (Math.random() - 0.5) * 0.004;
      return [coords[0] + jitter(), coords[1] + jitter()];
    }
  }
  return null;
}

function ensureMap() {
  if (state.map) return state.map;
  state.map = L.map("map").setView(PHILLY_CENTER, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(state.map);
  return state.map;
}

function renderMap() {
  const map = ensureMap();
  // Clear old markers.
  for (const m of state.mapMarkers) map.removeLayer(m);
  state.mapMarkers = [];

  const list = filteredProjects();
  for (const p of list) {
    const coords = geocodeLocation(p.location);
    if (!coords) continue;
    const catColor = CAT_COLORS[p.category]?.replace("var(--cat-", "").replace(")", "") || "other";
    const marker = L.circleMarker(coords, {
      radius: 9,
      color: "#fff",
      weight: 2,
      fillColor: cssVarToHex(CAT_COLORS[p.category]),
      fillOpacity: 0.9,
    });
    marker.bindPopup(
      `<strong>${escapeHtml(p.title)}</strong><br>` +
      `<span style="color:#666;font-size:0.85em">${escapeHtml(p.category)} • ${escapeHtml(p.status)}</span><br>` +
      `<a href="#" data-id="${p.id}" class="map-detail-link">View details →</a>`
    );
    marker.on("popupopen", (e) => {
      const link = e.popup.getElement().querySelector(".map-detail-link");
      if (link) link.addEventListener("click", (ev) => { ev.preventDefault(); openDetail(p.id); });
    });
    marker.addTo(map);
    state.mapMarkers.push(marker);
  }
  // Force size recompute when revealed from hidden.
  setTimeout(() => map.invalidateSize(), 50);
}

function cssVarToHex(v) {
  if (!v) return "#8b98a8";
  const tmp = document.createElement("div");
  tmp.style.color = v;
  document.body.appendChild(tmp);
  const computed = getComputedStyle(tmp).color;
  document.body.removeChild(tmp);
  const m = computed.match(/\d+/g);
  if (!m) return "#8b98a8";
  return "#" + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

// ---------- Settings modal ----------
function openSettings() {
  $("repo-input").value = PTW.getRepo();
  $("token-input").value = PTW.getToken();
  openModal("settings-modal");
}

async function saveSettings() {
  const repo = $("repo-input").value.trim();
  const token = $("token-input").value.trim();
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
  try {
    await PTW.verifyAccess();
    toast("Settings saved", "success");
    closeModal("settings-modal");
    await reloadProjects();
  } catch (err) {
    toast(`Could not access repo: ${err.message}`, "error");
  }
}

function clearSettings() {
  if (!confirm("Clear your GitHub token and repo from this browser?")) return;
  PTW.clear();
  $("repo-input").value = "";
  $("token-input").value = "";
  state.projects = [];
  renderTimeline();
  toast("Settings cleared");
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

  renderFilterChips();
  reloadProjects();
}

document.addEventListener("DOMContentLoaded", init);
