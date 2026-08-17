// server.js — Skill Matrix backend. Plain Node http server (no Express, no npm
// installs needed) + built-in SQLite (node:sqlite, Node 22+). Serves the REST API
// under /api/* and the static frontend from ../public.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const db = require('./db');
const auth = require('./auth');
const { LEVELS, scoreEmployees } = require('./matching');
const ollama = require('./ollama');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 5_000_000) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function getSessionOr401(req, res) {
  const token = auth.tokenFromReq(req);
  const session = token ? auth.getSession(token) : null;
  if (!session) { sendJson(res, 401, { error: 'Not signed in. Please log in again.' }); return null; }
  return session;
}

function requireRole(session, res, ...roles) {
  if (!roles.includes(session.role)) {
    sendJson(res, 403, { error: `This action needs one of these roles: ${roles.join(', ')}.` });
    return false;
  }
  return true;
}

function getEmployeeWithSkills(id) {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!emp) return null;
  emp.skills = db.prepare('SELECT skill_name, level, years FROM employee_skills WHERE employee_id = ?').all(id);
  return emp;
}
function getAllEmployeesWithSkills() {
  const emps = db.prepare('SELECT * FROM employees ORDER BY name').all();
  const skillStmt = db.prepare('SELECT skill_name, level, years FROM employee_skills WHERE employee_id = ?');
  for (const e of emps) e.skills = skillStmt.all(e.id);
  return emps;
}
function getProjectFull(id) {
  const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!proj) return null;
  proj.requiredSkills = db.prepare('SELECT skill_name AS name, min_level AS level FROM project_required_skills WHERE project_id = ?').all(id);
  proj.assigned = db.prepare('SELECT employee_id FROM project_assignments WHERE project_id = ?').all(id).map(r => r.employee_id);
  return proj;
}

// ---------------------------------------------------------------------------
// Route table: [method, regex, handler]. :id style params captured via regex.
// ---------------------------------------------------------------------------
const routes = [];
function on(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, regex, keys, handler });
}

// ---- Auth ----
on('POST', '/api/auth/login', async (req, res) => {
  const body = await readBody(req);
  const name = (body.name || '').trim();
  const role = body.role;
  if (!name) return sendJson(res, 400, { error: 'Name is required.' });
  if (!['Employee', 'Manager', 'Admin'].includes(role)) return sendJson(res, 400, { error: 'Invalid role.' });

  let employeeId = null;
  if (role === 'Employee') {
    const emp = auth.ensureEmployeeForLogin(name);
    employeeId = emp.id;
  }
  const token = auth.createSession({ name, role, employeeId });
  sendJson(res, 200, { token, user: { name, role, employeeId } });
});

on('POST', '/api/auth/logout', async (req, res) => {
  const token = auth.tokenFromReq(req);
  if (token) auth.destroySession(token);
  sendJson(res, 200, { ok: true });
});

on('GET', '/api/me', async (req, res) => {
  const session = getSessionOr401(req, res);
  if (!session) return;
  sendJson(res, 200, { user: session });
});

// ---- Employees ----
on('GET', '/api/employees', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  sendJson(res, 200, { employees: getAllEmployeesWithSkills() });
});

on('GET', '/api/employees/:id', async (req, res, params) => {
  const session = getSessionOr401(req, res); if (!session) return;
  const emp = getEmployeeWithSkills(Number(params.id));
  if (!emp) return sendJson(res, 404, { error: 'Employee not found.' });
  sendJson(res, 200, { employee: emp });
});

on('POST', '/api/employees', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Admin')) return;
  const body = await readBody(req);
  const { record, error } = validateEmployeePayload(body);
  if (error) return sendJson(res, 400, { error });
  const result = db.prepare(
    'INSERT INTO employees (name,designation,department,experience,availability) VALUES (?,?,?,?,?)'
  ).run(record.name, record.designation, record.department, record.experience, record.availability);
  const id = Number(result.lastInsertRowid);
  saveSkills(id, record.skills);
  sendJson(res, 201, { employee: getEmployeeWithSkills(id) });
});

on('PUT', '/api/employees/:id', async (req, res, params) => {
  const session = getSessionOr401(req, res); if (!session) return;
  const id = Number(params.id);
  const isSelf = session.role === 'Employee' && session.employeeId === id;
  if (!isSelf && !requireRole(session, res, 'Admin')) return;
  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
  if (!existing) return sendJson(res, 404, { error: 'Employee not found.' });
  const body = await readBody(req);
  const { record, error } = validateEmployeePayload(body);
  if (error) return sendJson(res, 400, { error });
  db.prepare(
    'UPDATE employees SET name=?, designation=?, department=?, experience=?, availability=? WHERE id=?'
  ).run(record.name, record.designation, record.department, record.experience, record.availability, id);
  saveSkills(id, record.skills);
  sendJson(res, 200, { employee: getEmployeeWithSkills(id) });
});

on('DELETE', '/api/employees/:id', async (req, res, params) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Admin')) return;
  const id = Number(params.id);
  db.prepare('DELETE FROM employees WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true });
});

function validateEmployeePayload(body) {
  const name = (body.name || '').trim();
  if (!name) return { error: 'Employee name is required.' };
  const availability = ['Available', 'Partial', 'Allocated'].includes(body.availability) ? body.availability : 'Available';
  const skills = Array.isArray(body.skills) ? body.skills
    .filter(s => s && s.name && String(s.name).trim())
    .map(s => ({
      name: String(s.name).trim(),
      level: LEVELS.includes(s.level) ? s.level : 'Beginner',
      years: s.years != null && s.years !== '' ? Number(s.years) : null
    })) : [];
  return {
    record: {
      name,
      designation: String(body.designation || '').trim(),
      department: String(body.department || '').trim(),
      experience: Number(body.experience) || 0,
      availability,
      skills
    }
  };
}
function saveSkills(employeeId, skills) {
  db.prepare('DELETE FROM employee_skills WHERE employee_id = ?').run(employeeId);
  const ins = db.prepare('INSERT INTO employee_skills (employee_id, skill_name, level, years) VALUES (?,?,?,?)');
  for (const s of skills) ins.run(employeeId, s.name, s.level, s.years);
}

// ---- Skill Taxonomy ----
on('GET', '/api/taxonomy', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  sendJson(res, 200, { taxonomy: db.prepare('SELECT * FROM skills_taxonomy ORDER BY category, name').all() });
});

on('POST', '/api/taxonomy', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Admin')) return;
  const body = await readBody(req);
  const name = (body.name || '').trim();
  const category = (body.category || 'Domain Knowledge').trim();
  if (!name) return sendJson(res, 400, { error: 'Skill name is required.' });
  const dup = db.prepare('SELECT id FROM skills_taxonomy WHERE LOWER(name) = LOWER(?)').get(name);
  if (dup) return sendJson(res, 409, { error: 'This skill already exists in the taxonomy.' });
  const result = db.prepare('INSERT INTO skills_taxonomy (name, category) VALUES (?,?)').run(name, category);
  sendJson(res, 201, { skill: { id: Number(result.lastInsertRowid), name, category } });
});

on('DELETE', '/api/taxonomy/:id', async (req, res, params) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Admin')) return;
  db.prepare('DELETE FROM skills_taxonomy WHERE id = ?').run(Number(params.id));
  sendJson(res, 200, { ok: true });
});

on('GET', '/api/taxonomy/unmapped', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  const taxNames = new Set(db.prepare('SELECT name FROM skills_taxonomy').all().map(r => r.name.toLowerCase()));
  const used = db.prepare('SELECT skill_name FROM employee_skills').all();
  const freq = {};
  for (const row of used) {
    const key = row.skill_name.trim();
    if (!key || taxNames.has(key.toLowerCase())) continue;
    freq[key] = (freq[key] || 0) + 1;
  }
  const unmapped = Object.entries(freq).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  sendJson(res, 200, { unmapped });
});

on('POST', '/api/taxonomy/merge', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Admin')) return;
  const body = await readBody(req);
  const from = (body.from || '').trim();
  const to = (body.to || '').trim();
  if (!from || !to) return sendJson(res, 400, { error: 'Both "from" and "to" skill names are required.' });
  db.prepare('UPDATE employee_skills SET skill_name = ? WHERE LOWER(skill_name) = LOWER(?)').run(to, from);
  sendJson(res, 200, { ok: true });
});

on('POST', '/api/taxonomy/promote', async (req, res) => {
  // Add an unmapped skill straight into the taxonomy under a chosen category.
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Admin')) return;
  const body = await readBody(req);
  const name = (body.name || '').trim();
  const category = (body.category || 'Domain Knowledge').trim();
  if (!name) return sendJson(res, 400, { error: 'Skill name is required.' });
  const dup = db.prepare('SELECT id FROM skills_taxonomy WHERE LOWER(name) = LOWER(?)').get(name);
  if (dup) return sendJson(res, 409, { error: 'Already in the taxonomy.' });
  db.prepare('INSERT INTO skills_taxonomy (name, category) VALUES (?,?)').run(name, category);
  sendJson(res, 201, { ok: true });
});

// ---- Projects ----
on('GET', '/api/projects', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const ids = db.prepare('SELECT id FROM projects ORDER BY id DESC').all().map(r => r.id);
  sendJson(res, 200, { projects: ids.map(getProjectFull) });
});

on('POST', '/api/projects', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const body = await readBody(req);
  const name = (body.name || '').trim();
  if (!name) return sendJson(res, 400, { error: 'Project name is required.' });
  const status = ['Planning', 'Active', 'Completed'].includes(body.status) ? body.status : 'Planning';
  const client = String(body.client || '').trim();
  const result = db.prepare('INSERT INTO projects (name, client, status) VALUES (?,?,?)').run(name, client, status);
  const id = Number(result.lastInsertRowid);
  const reqSkills = Array.isArray(body.requiredSkills) ? body.requiredSkills : [];
  const ins = db.prepare('INSERT INTO project_required_skills (project_id, skill_name, min_level) VALUES (?,?,?)');
  for (const s of reqSkills) {
    if (s && s.name && String(s.name).trim()) {
      ins.run(id, String(s.name).trim(), LEVELS.includes(s.level) ? s.level : 'Beginner');
    }
  }
  sendJson(res, 201, { project: getProjectFull(id) });
});

on('DELETE', '/api/projects/:id', async (req, res, params) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Admin')) return;
  db.prepare('DELETE FROM projects WHERE id = ?').run(Number(params.id));
  sendJson(res, 200, { ok: true });
});

on('GET', '/api/projects/:id/candidates', async (req, res, params) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const proj = getProjectFull(Number(params.id));
  if (!proj) return sendJson(res, 404, { error: 'Project not found.' });
  const all = getAllEmployeesWithSkills().filter(e => !proj.assigned.includes(e.id));
  const ranked = scoreEmployees(all, proj.requiredSkills);
  sendJson(res, 200, { candidates: ranked });
});

on('POST', '/api/projects/:id/assign', async (req, res, params) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const projectId = Number(params.id);
  const body = await readBody(req);
  const employeeId = Number(body.employeeId);
  db.prepare('INSERT OR IGNORE INTO project_assignments (project_id, employee_id) VALUES (?,?)').run(projectId, employeeId);
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (emp && emp.availability === 'Available') {
    db.prepare('UPDATE employees SET availability = ? WHERE id = ?').run('Partial', employeeId);
  }
  sendJson(res, 200, { project: getProjectFull(projectId) });
});

on('POST', '/api/projects/:id/unassign', async (req, res, params) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const projectId = Number(params.id);
  const body = await readBody(req);
  const employeeId = Number(body.employeeId);
  db.prepare('DELETE FROM project_assignments WHERE project_id = ? AND employee_id = ?').run(projectId, employeeId);
  sendJson(res, 200, { project: getProjectFull(projectId) });
});

// ---- Search ----
on('POST', '/api/search/match', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const body = await readBody(req);
  const requiredSkills = Array.isArray(body.requiredSkills) ? body.requiredSkills : [];
  const ranked = scoreEmployees(getAllEmployeesWithSkills(), requiredSkills);
  sendJson(res, 200, { results: ranked });
});

on('POST', '/api/search/ai', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const body = await readBody(req);
  const query = (body.query || '').trim();
  if (!query) return sendJson(res, 400, { error: 'A search query is required.' });
  const knownSkills = db.prepare('SELECT name FROM skills_taxonomy').all().map(r => r.name);
  try {
    const skills = await ollama.parseStaffingQuery(query, knownSkills);
    const ranked = scoreEmployees(getAllEmployeesWithSkills(), skills);
    sendJson(res, 200, { parsedSkills: skills, results: ranked });
  } catch (e) {
    sendJson(res, 503, {
      error: 'AI search is unavailable — is Ollama running locally? (ollama serve, with a model pulled via `ollama pull llama3.2`)',
      detail: String(e.message || e)
    });
  }
});

// ---- Reports ----
on('GET', '/api/reports/utilization', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const rows = db.prepare('SELECT availability, COUNT(*) AS c FROM employees GROUP BY availability').all();
  const counts = { Available: 0, Partial: 0, Allocated: 0 };
  for (const r of rows) counts[r.availability] = r.c;
  sendJson(res, 200, { counts, total: db.prepare('SELECT COUNT(*) c FROM employees').get().c });
});

on('GET', '/api/reports/skill-gap', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const projects = db.prepare("SELECT id FROM projects WHERE status != 'Completed'").all();
  const needMap = new Map(); // lowerName -> { name, levelIdx }
  for (const p of projects) {
    const reqs = db.prepare('SELECT skill_name, min_level FROM project_required_skills WHERE project_id = ?').all(p.id);
    for (const r of reqs) {
      const key = r.skill_name.toLowerCase();
      const idx = LEVELS.indexOf(r.min_level);
      if (!needMap.has(key) || idx > needMap.get(key).levelIdx) needMap.set(key, { name: r.skill_name, levelIdx: idx });
    }
  }
  const allEmployees = getAllEmployeesWithSkills();
  const gaps = [...needMap.values()].map(g => {
    const qualified = allEmployees.filter(e =>
      e.skills.some(s => s.skill_name.toLowerCase() === g.name.toLowerCase() && LEVELS.indexOf(s.level) >= g.levelIdx)
    ).length;
    return { skill: g.name, minLevel: LEVELS[g.levelIdx], qualified, atRisk: qualified < 2 };
  });
  sendJson(res, 200, { gaps });
});

on('GET', '/api/reports/departments', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Manager', 'Admin')) return;
  const rows = db.prepare(
    "SELECT COALESCE(NULLIF(TRIM(department),''),'Unassigned') AS dept, COUNT(*) AS c FROM employees GROUP BY dept ORDER BY c DESC"
  ).all();
  sendJson(res, 200, { departments: rows });
});

// ---- Backup / export / import ----
on('GET', '/api/backup/export', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Admin')) return;
  const employees = getAllEmployeesWithSkills();
  const taxonomy = db.prepare('SELECT name, category FROM skills_taxonomy').all();
  const projectIds = db.prepare('SELECT id FROM projects').all().map(r => r.id);
  const projects = projectIds.map(getProjectFull);
  sendJson(res, 200, { employees, taxonomy, projects, exportedAt: new Date().toISOString() });
});

on('POST', '/api/backup/import', async (req, res) => {
  const session = getSessionOr401(req, res); if (!session) return;
  if (!requireRole(session, res, 'Admin')) return;
  const body = await readBody(req);
  db.exec('DELETE FROM project_assignments; DELETE FROM project_required_skills; DELETE FROM projects;');
  db.exec('DELETE FROM employee_skills; DELETE FROM employees;');
  db.exec('DELETE FROM skills_taxonomy;');

  const insEmp = db.prepare('INSERT INTO employees (id,name,designation,department,experience,availability) VALUES (?,?,?,?,?,?)');
  const insSkill = db.prepare('INSERT INTO employee_skills (employee_id, skill_name, level, years) VALUES (?,?,?,?)');
  for (const e of (body.employees || [])) {
    insEmp.run(e.id, e.name, e.designation || '', e.department || '', e.experience || 0, e.availability || 'Available');
    for (const s of (e.skills || [])) insSkill.run(e.id, s.skill_name || s.name, s.level, s.years ?? null);
  }
  const insTax = db.prepare('INSERT INTO skills_taxonomy (name, category) VALUES (?,?)');
  for (const t of (body.taxonomy || [])) insTax.run(t.name, t.category || 'Domain Knowledge');

  const insProj = db.prepare('INSERT INTO projects (id, name, client, status) VALUES (?,?,?,?)');
  const insReq = db.prepare('INSERT INTO project_required_skills (project_id, skill_name, min_level) VALUES (?,?,?)');
  const insAssign = db.prepare('INSERT INTO project_assignments (project_id, employee_id) VALUES (?,?)');
  for (const p of (body.projects || [])) {
    insProj.run(p.id, p.name, p.client || '', p.status || 'Planning');
    for (const s of (p.requiredSkills || [])) insReq.run(p.id, s.name, s.level);
    for (const empId of (p.assigned || [])) insAssign.run(p.id, empId);
  }
  sendJson(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// Static file serving for the frontend
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const m = pathname.match(route.regex);
      if (!m) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = m[i + 1]; });
      try {
        return await route.handler(req, res, params);
      } catch (e) {
        console.error(e);
        return sendJson(res, 500, { error: 'Internal server error', detail: String(e.message || e) });
      }
    }
    return sendJson(res, 404, { error: 'No such API route.' });
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Skill Matrix server running at http://localhost:${PORT}`);
  console.log(`Database file: ${path.join(__dirname, 'data', 'skillmatrix.db')}`);
});
