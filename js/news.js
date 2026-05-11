// Auto-fetch news for a project using Google News RSS via rss2json.com
// (rss2json handles CORS and converts RSS into JSON). Free tier: 10k req/day.
// Results are cached in localStorage for 30 minutes per project.

const PTW_News = (() => {
  const CACHE_PREFIX = "ptw_news_";
  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  function buildQuery(project) {
    const terms = (project.searchTerms || project.title || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (!terms.length) return null;
    // Quote each term, OR them, then AND philadelphia for relevance.
    const q = terms.map((t) => `"${t}"`).join(" OR ");
    return `(${q}) Philadelphia`;
  }

  async function fetchNews(project, { force = false } = {}) {
    const cacheKey = `${CACHE_PREFIX}${project.id}`;
    if (!force) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { ts, items } = JSON.parse(cached);
          if (Date.now() - ts < CACHE_TTL_MS) return items;
        } catch (_) {}
      }
    }
    const query = buildQuery(project);
    if (!query) return [];
    const gnewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(gnewsUrl)}`;
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`News fetch failed: ${res.status}`);
      const json = await res.json();
      if (json.status !== "ok") throw new Error(json.message || "News fetch returned error");
      const items = (json.items || []).slice(0, 10).map((it) => ({
        title: it.title,
        link: it.link,
        source: extractSource(it.title, it.author),
        publishedAt: it.pubDate,
        snippet: stripHtml(it.description).slice(0, 200),
      }));
      localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items }));
      return items;
    } catch (err) {
      console.error("News fetch error:", err);
      return [];
    }
  }

  function extractSource(title, author) {
    // Google News titles look like: "Headline - Publisher"
    const m = title.match(/ - ([^-]+)$/);
    if (m) return m[1].trim();
    return author || "Source";
  }

  function stripHtml(s) {
    const div = document.createElement("div");
    div.innerHTML = s || "";
    return div.textContent || "";
  }

  return { fetchNews };
})();
