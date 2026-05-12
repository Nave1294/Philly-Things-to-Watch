// Anthropic API client for project auto-fill.
// Calls Claude with web search to look up a project by name and return
// structured fields the user can apply (or override) on the Add Project form.
//
// Your API key is stored only in this browser's localStorage. The call is
// made directly from the browser using the documented "dangerous direct
// browser access" flag — fine for a personal tool where you control the key.

const PTW_Claude = (() => {
  const LS_KEY = "ptw_claude_key";
  const LS_MODEL = "ptw_claude_model";
  const DEFAULT_MODEL = "claude-sonnet-4-6";

  function getKey() { return localStorage.getItem(LS_KEY) || ""; }
  function setKey(k) { localStorage.setItem(LS_KEY, k); }
  function getModel() { return localStorage.getItem(LS_MODEL) || DEFAULT_MODEL; }
  function setModel(m) { localStorage.setItem(LS_MODEL, m); }
  function isConfigured() { return !!getKey(); }
  function clear() {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_MODEL);
  }

  const SYSTEM_PROMPT = `You help users track Philadelphia-area projects (transportation, development, parks, trials, politics, sports/stadiums, events).

When asked to look up a project by name, use web search to find current, accurate information. Always search in the Philadelphia / Philly / PA context. If the user's name is ambiguous, pick the most prominent match but note the ambiguity in clarifyingQuestion.

Respond with ONLY a JSON object — no markdown fences, no prose before or after. Use exactly this schema:

{
  "confirmedName": "<official or commonly-used project name>",
  "category": "<one of: Transportation | Development | Parks & Public Space | Trials & Legal | Politics | Sports & Stadiums | Events | Other>",
  "status": "<one of: Proposed | Planning | Approved | In Progress | On Hold | Completed | Cancelled>",
  "description": "<2-3 sentence factual summary>",
  "startDate": "<YYYY-MM-DD or empty string>",
  "completionDate": "<YYYY-MM-DD estimated completion or empty string>",
  "location": "<most specific location possible — full street address preferred, then intersection, then neighborhood>",
  "searchTerms": "<comma-separated phrases useful for tracking future news>",
  "links": ["<2-4 relevant URLs: official source, Wikipedia, recent news articles>"],
  "phases": [
    {"name": "<short phase name, e.g. 'Proposed', 'Groundbreaking', 'Construction begins', 'Service starts', 'Completion'>", "date": "<YYYY-MM-DD>"}
  ],
  "confidence": "<high | medium | low>",
  "clarifyingQuestion": "<question string, or null if no ambiguity>"
}

For "phases": list every major dated milestone you can verify — both past (already happened) and expected (scheduled). Aim for 3-6 phases. Typical examples:
- Buildings: Proposed → Approved → Groundbreaking → Topping out → Completion
- Transit projects: Proposed → Environmental review → Funded → Construction begins → Service starts
- Stadiums/arenas: Proposed → City approval → Groundbreaking → Opening
- Parks: Proposed → Funded → Construction begins → Opens to public
- Trials: Charges filed → Trial begins → Verdict → Sentencing/Appeal
Use the actual or projected date if known; omit phases whose dates aren't reasonably knowable. Never invent dates.

For "location": be as specific as you can. Preferred order:
1. Full street address (e.g. "1300 South Penn Square, Philadelphia, PA")
2. Nearest intersection (e.g. "Front Street and Berks Street, Philadelphia, PA")
3. A nearby landmark with street context (e.g. "Penn's Landing waterfront at Walnut Street")
4. Only fall back to a neighborhood name if nothing more specific is verifiable.
The goal is something geocodable — never just a vague district like "Center City" if you can avoid it.

Use empty strings or empty arrays for unknown fields.`;

  async function callClaude(systemPrompt, userMessage) {
    if (!getKey()) throw new Error("Claude API key not configured. Add one in Settings.");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": getKey(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 2048,
        system: systemPrompt,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
        }],
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = `${res.status}`;
      try {
        const errJson = JSON.parse(errText);
        msg = errJson.error?.message || msg;
      } catch (_) {}
      throw new Error(`Claude API error: ${msg}`);
    }

    const json = await res.json();
    const textBlocks = (json.content || []).filter((b) => b.type === "text");
    if (!textBlocks.length) throw new Error("Claude returned no text response");
    const text = textBlocks.map((b) => b.text).join("\n").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Claude's response was not JSON.");
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error("Could not parse Claude's response as JSON: " + e.message);
    }
  }

  async function lookupProject(name) {
    return callClaude(
      SYSTEM_PROMPT,
      `Look up this Philadelphia-area project: "${name}". Return the JSON described in the system prompt.`
    );
  }

  const REFRESH_SYSTEM_PROMPT = `You help track Philadelphia-area projects and find the latest updates on them.

You will be given an existing project record. Your job is to search for the most current information about this project and return updated data.

Focus specifically on:
- Any milestone dates that have been announced, changed, or confirmed since the project was last checked
- Status changes (groundbreaking happened, approval granted, project delayed, completed, cancelled)
- Updated completion estimates
- New phases that were announced or that have now passed
- Any significant news from the past 6 months

Search using the project name AND all of its search terms. Prioritize sources from the past year, especially the past 6 months. Look for recent news articles, official announcements, and project websites.

Respond with ONLY a JSON object — no markdown fences, no prose before or after. Use exactly this schema:

{
  "confirmedName": "<official or commonly-used project name>",
  "category": "<one of: Transportation | Development | Parks & Public Space | Trials & Legal | Politics | Sports & Stadiums | Events | Other>",
  "status": "<one of: Proposed | Planning | Approved | In Progress | On Hold | Completed | Cancelled>",
  "description": "<2-3 sentence factual summary reflecting the most current state>",
  "startDate": "<YYYY-MM-DD or empty string>",
  "completionDate": "<YYYY-MM-DD estimated completion or empty string>",
  "location": "<most specific location possible — full street address preferred>",
  "searchTerms": "<comma-separated phrases useful for tracking future news>",
  "links": ["<2-4 relevant URLs prioritizing the most recent news articles and official sources>"],
  "phases": [
    {"name": "<short phase name>", "date": "<YYYY-MM-DD>"}
  ],
  "confidence": "<high | medium | low>",
  "clarifyingQuestion": null
}

For "phases": return ALL known milestones — both past and future. Merge what you already know (provided below) with any newly discovered dates. If a previously estimated date has changed, use the updated date. Never invent dates — only include dates you can verify or that are officially projected.

Use empty strings or empty arrays for fields where nothing new was found.`;

  async function refreshProject(project) {
    const existingPhases = Array.isArray(project.phases) && project.phases.length
      ? project.phases.map((p) => `  ${p.date}: ${p.name}`).join("\n")
      : "  (none recorded yet)";

    const lastChecked = project.lastAutoRefresh
      ? `Last checked: ${project.lastAutoRefresh}.`
      : "This project has not been auto-checked before.";

    const userMessage =
      `Find the latest updates for this Philadelphia-area project.\n\n` +
      `Project name: "${project.title}"\n` +
      `Search terms: ${project.searchTerms || project.title}\n` +
      `Current status: ${project.status}\n` +
      `${lastChecked}\n\n` +
      `Currently recorded phases:\n${existingPhases}\n\n` +
      `Search for recent news and announcements. Return the full updated JSON per the system prompt, ` +
      `including all known phases (existing + any newly found). Focus on finding information published ` +
      `after ${project.lastAutoRefresh || "the past year"}.`;

    return callClaude(REFRESH_SYSTEM_PROMPT, userMessage);
  }

  return { getKey, setKey, getModel, setModel, isConfigured, clear, lookupProject, refreshProject };
})();
