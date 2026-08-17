// ollama.js — talks to a locally running Ollama instance to turn a plain-English
// staffing request ("need a senior React dev who also knows AWS") into structured
// { skills: [{ name, level }] } filters the matching engine can use.
//
// Requires Ollama running locally (default http://localhost:11434) with a model
// pulled, e.g.:  ollama pull llama3.2
//
// If Ollama isn't running or the call fails, this throws — the API route catches
// that and tells the frontend to fall back to manual skill-picker search, so the
// AI feature is an enhancement, never a hard dependency.

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"];

async function parseStaffingQuery(query, knownSkillNames = []) {
  const prompt = `You convert a staffing request into strict JSON. Allowed proficiency levels: ${LEVELS.join(", ")}.
Known skill names in our taxonomy (prefer matching these exact spellings when the request clearly refers to one): ${knownSkillNames.join(", ") || "(none yet)"}.

Return ONLY valid JSON in this exact shape, nothing else, no markdown fences:
{"skills":[{"name":"<skill name>","level":"<one of the allowed levels, default Intermediate if unspecified>"}]}

Staffing request: "${query}"`;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, format: 'json' })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  let parsed;
  try {
    parsed = JSON.parse(data.response);
  } catch (e) {
    throw new Error('Ollama response was not valid JSON: ' + String(data.response).slice(0, 200));
  }

  const skills = Array.isArray(parsed.skills) ? parsed.skills
    .filter(s => s && s.name)
    .map(s => ({
      name: String(s.name).trim(),
      level: LEVELS.includes(s.level) ? s.level : 'Intermediate'
    })) : [];

  return skills;
}

module.exports = { parseStaffingQuery, OLLAMA_HOST, OLLAMA_MODEL, parseStaffingQueryFallback };

// ---------------------------------------------------------------------------
// Fallback parser — no external service, no installation required.
// Used automatically when Ollama isn't reachable (e.g. locked-down company
// laptops that can't install new software). It's simple keyword matching, not
// a real language model, so it won't handle everything an LLM would — but it
// covers the common case: skill names from the taxonomy mentioned in the
// query, plus seniority words mapped to proficiency levels.
// ---------------------------------------------------------------------------
const LEVEL_WORDS = {
  expert: 'Expert', principal: 'Expert', lead: 'Expert', '10x': 'Expert',
  senior: 'Advanced', advanced: 'Advanced', experienced: 'Advanced',
  intermediate: 'Intermediate', mid: 'Intermediate', 'mid-level': 'Intermediate',
  junior: 'Beginner', beginner: 'Beginner', entry: 'Beginner', 'entry-level': 'Beginner', trainee: 'Beginner'
};

function detectGlobalLevel(queryLower) {
  for (const word of Object.keys(LEVEL_WORDS)) {
    if (queryLower.includes(word)) return LEVEL_WORDS[word];
  }
  return 'Intermediate';
}

function parseStaffingQueryFallback(query, knownSkillNames = []) {
  const queryLower = query.toLowerCase();
  const globalLevel = detectGlobalLevel(queryLower);
  const skills = [];
  const seen = new Set();

  // Match known taxonomy skill names that appear as whole words/phrases in the query.
  for (const name of knownSkillNames) {
    const nameLower = name.toLowerCase();
    if (!nameLower) continue;
    const escaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    if (re.test(queryLower) && !seen.has(nameLower)) {
      seen.add(nameLower);
      skills.push({ name, level: globalLevel });
    }
  }
  return skills;
}
