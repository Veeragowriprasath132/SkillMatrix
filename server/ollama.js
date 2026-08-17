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

module.exports = { parseStaffingQuery, OLLAMA_HOST, OLLAMA_MODEL };
