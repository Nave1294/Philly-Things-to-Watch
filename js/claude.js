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
  "location": "<Philly neighborhood or street address>",
  "searchTerms": "<comma-separated phrases useful for tracking future news>",
  "links": ["<2-4 relevant URLs: official source, Wikipedia, recent news articles>"],
  "confidence": "<high | medium | low>",
  "clarifyingQuestion": "<question string, or null if no ambiguity>"
}

Use empty strings or empty arrays for unknown fields. Never invent dates.`;

  async function lookupProject(name) {
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
        system: SYSTEM_PROMPT,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 5,
        }],
        messages: [{
          role: "user",
          content: `Look up this Philadelphia-area project: "${name}". Return the JSON described in the system prompt.`,
        }],
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
    if (!textBlocks.length) {
      throw new Error("Claude returned no text response");
    }
    const text = textBlocks.map((b) => b.text).join("\n").trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Claude's response was not JSON. Try a more specific project name.");
    }
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error("Could not parse Claude's response as JSON: " + e.message);
    }
  }

  return { getKey, setKey, getModel, setModel, isConfigured, clear, lookupProject };
})();
