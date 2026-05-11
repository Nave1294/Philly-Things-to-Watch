// GitHub API client.
// Each project is a GitHub Issue. Structured fields live in a JSON code block
// at the bottom of the issue body, between <!-- PTW:BEGIN --> and <!-- PTW:END -->.
// Updates are issue comments. Categories and statuses are also issue labels
// so the GitHub UI stays useful too.

const PTW = (() => {
  const LS_TOKEN = "ptw_token";
  const LS_REPO = "ptw_repo";
  const BEGIN = "<!-- PTW:BEGIN -->";
  const END = "<!-- PTW:END -->";
  const APP_LABEL = "ptw-tracked";

  function getToken() { return localStorage.getItem(LS_TOKEN) || ""; }
  function getRepo() { return localStorage.getItem(LS_REPO) || ""; }
  function setToken(t) { localStorage.setItem(LS_TOKEN, t); }
  function setRepo(r) { localStorage.setItem(LS_REPO, r); }
  function clear() {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_REPO);
  }
  function isConfigured() { return !!(getToken() && getRepo()); }

  async function gh(path, options = {}) {
    const token = getToken();
    if (!token) throw new Error("No GitHub token configured");
    const res = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function encodeBody(description, data) {
    const desc = description || "";
    return `${desc}\n\n${BEGIN}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n${END}`;
  }

  function decodeBody(body) {
    if (!body) return { description: "", data: {} };
    const beginIdx = body.indexOf(BEGIN);
    if (beginIdx === -1) return { description: body.trim(), data: {} };
    const endIdx = body.indexOf(END, beginIdx);
    const description = body.slice(0, beginIdx).trim();
    const block = body.slice(beginIdx + BEGIN.length, endIdx === -1 ? undefined : endIdx);
    const match = block.match(/```json\s*([\s\S]*?)\s*```/);
    if (!match) return { description, data: {} };
    try {
      return { description, data: JSON.parse(match[1]) };
    } catch (e) {
      return { description, data: {} };
    }
  }

  function issueToProject(issue) {
    const { description, data } = decodeBody(issue.body);
    return {
      id: issue.number,
      title: issue.title,
      description,
      category: data.category || "Other",
      status: data.status || "Proposed",
      startDate: data.startDate || "",
      completionDate: data.completionDate || "",
      location: data.location || "",
      searchTerms: data.searchTerms || "",
      links: data.links || [],
      lastAutoRefresh: data.lastAutoRefresh || "",
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      githubState: issue.state,
      commentCount: issue.comments,
      url: issue.html_url,
    };
  }

  async function ensureLabel(name, color) {
    try {
      await gh(`/repos/${getRepo()}/labels/${encodeURIComponent(name)}`);
    } catch (e) {
      try {
        await gh(`/repos/${getRepo()}/labels`, {
          method: "POST",
          body: JSON.stringify({ name, color }),
        });
      } catch (err) { /* race or perms — ignore */ }
    }
  }

  async function listProjects() {
    // Pull all open + closed issues tagged with our app label.
    const all = [];
    let page = 1;
    while (true) {
      const batch = await gh(
        `/repos/${getRepo()}/issues?state=all&labels=${APP_LABEL}&per_page=100&page=${page}`
      );
      if (!batch.length) break;
      all.push(...batch.filter((i) => !i.pull_request));
      if (batch.length < 100) break;
      page++;
    }
    return all.map(issueToProject);
  }

  async function createProject(p) {
    await ensureLabel(APP_LABEL, "fdb913");
    const labels = [APP_LABEL, `cat:${p.category}`, `status:${p.status}`];
    for (const l of labels) await ensureLabel(l, "888888");
    const data = {
      category: p.category,
      status: p.status,
      startDate: p.startDate,
      completionDate: p.completionDate,
      location: p.location,
      searchTerms: p.searchTerms,
      links: p.links,
      lastAutoRefresh: p.lastAutoRefresh || "",
    };
    const issue = await gh(`/repos/${getRepo()}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: p.title,
        body: encodeBody(p.description, data),
        labels,
      }),
    });
    return issueToProject(issue);
  }

  async function updateProject(id, p) {
    const labels = [APP_LABEL, `cat:${p.category}`, `status:${p.status}`];
    for (const l of labels) await ensureLabel(l, "888888");
    const data = {
      category: p.category,
      status: p.status,
      startDate: p.startDate,
      completionDate: p.completionDate,
      location: p.location,
      searchTerms: p.searchTerms,
      links: p.links,
      lastAutoRefresh: p.lastAutoRefresh || "",
    };
    const state = p.status === "Completed" || p.status === "Cancelled" ? "closed" : "open";
    const issue = await gh(`/repos/${getRepo()}/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: p.title,
        body: encodeBody(p.description, data),
        labels,
        state,
      }),
    });
    return issueToProject(issue);
  }

  async function deleteProject(id) {
    // GitHub Issues can't be deleted via REST without GraphQL+permissions.
    // Close it and strip the app label so it falls out of the timeline.
    await gh(`/repos/${getRepo()}/issues/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed", labels: [] }),
    });
  }

  async function listUpdates(id) {
    const comments = await gh(`/repos/${getRepo()}/issues/${id}/comments?per_page=100`);
    return comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      author: c.user?.login,
    }));
  }

  async function addUpdate(id, body) {
    const comment = await gh(`/repos/${getRepo()}/issues/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    return {
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
      author: comment.user?.login,
    };
  }

  async function verifyAccess() {
    await gh(`/repos/${getRepo()}`);
    return true;
  }

  return {
    getToken, getRepo, setToken, setRepo, clear, isConfigured,
    listProjects, createProject, updateProject, deleteProject,
    listUpdates, addUpdate, verifyAccess,
  };
})();
