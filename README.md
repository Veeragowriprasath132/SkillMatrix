# Skill Matrix Management System — Full Stack

A real backend, database, and REST API for the Employee Skill Matrix system, plus
the same frontend UI from earlier phases now wired to that API instead of
browser-only storage. Optional natural-language search is powered by a locally
running [Ollama](https://ollama.com) model.

## Why this stack

- **Backend:** plain Node.js (`http` module) — no Express, no framework.
- **Database:** SQLite via Node's built-in `node:sqlite` module (Node 22+). No
  npm install, no separate database server to run.
- **Zero npm dependencies.** `npm install` isn't even needed — just run `node
  server/server.js`.
- **AI search:** optional. Calls a local Ollama instance to turn a plain-English
  staffing request into structured skill filters. If Ollama isn't running, that
  one feature degrades gracefully (clear error message, rest of the app
  unaffected) — it's never a hard dependency for the core system.

## Requirements

- Node.js **22 or later** (for `node:sqlite`). Check with `node --version`.
- (Optional, for AI search) [Ollama](https://ollama.com) installed locally.

## Running it

```bash
cd skillmatrix-app
node server/server.js
```

Open **http://localhost:3000** in your browser. That's it — no build step, no
`npm install`. The SQLite database file is created automatically at
`server/data/skillmatrix.db` on first run, seeded with 5 sample employees and a
starter skill taxonomy.

To use a different port: `PORT=4000 node server/server.js`

## Enabling AI-powered search (optional)

1. Install Ollama from https://ollama.com
2. Pull a small model: `ollama pull llama3.2`
3. Make sure Ollama is running (it usually starts automatically; otherwise run
   `ollama serve`)
4. In the app, go to **Search & Match** and use the "Ask in plain English" box,
   e.g. *"I need a senior AWS person who also knows Kubernetes"*

If you use a different model or host, set environment variables before
starting the server:

```bash
OLLAMA_MODEL=llama3.1 OLLAMA_HOST=http://localhost:11434 node server/server.js
```

## Project structure

```
skillmatrix-app/
  server/
    server.js          Main HTTP server + all API routes
    db.js               SQLite schema + seed data
    auth.js              In-memory session/token handling
    matching.js          Skill-matching/scoring logic (shared by search, projects, reports)
    ollama.js            Ollama integration for natural-language search
    data/
      skillmatrix.db     Created automatically — the actual database file
  public/
    index.html           Frontend (fetches the API; no build tooling needed)
  package.json
  README.md
```

## Data model (SQLite tables)

- **employees** — id, name, designation, department, experience, availability
- **employee_skills** — employee_id, skill_name, level, years (free-text skill
  name, so the taxonomy's "unmapped skills" detector has something to catch)
- **skills_taxonomy** — id, name, category — the standardized skill list
- **projects** — id, name, client, status
- **project_required_skills** — project_id, skill_name, min_level
- **project_assignments** — project_id, employee_id (who's staffed where)

## API overview

All endpoints are under `/api`. Authenticated requests send `Authorization:
Bearer <token>` (issued by `/api/auth/login`).

| Method & Path | Role required | Purpose |
|---|---|---|
| POST /api/auth/login | — | `{name, role}` → issues a token |
| POST /api/auth/logout | any | invalidates the token |
| GET /api/me | any | current session info |
| GET /api/employees | any | full roster with skills |
| GET /api/employees/:id | any | one employee |
| POST /api/employees | Admin | create employee |
| PUT /api/employees/:id | Admin, or the employee themself | update |
| DELETE /api/employees/:id | Admin | remove |
| GET /api/taxonomy | any | standardized skill list |
| POST /api/taxonomy | Admin | add a skill |
| DELETE /api/taxonomy/:id | Admin | remove a skill |
| GET /api/taxonomy/unmapped | any | skills in use but not standardized |
| POST /api/taxonomy/merge | Admin | rename a stray skill name into a canonical one |
| POST /api/taxonomy/promote | Admin | promote an unmapped skill into the taxonomy |
| GET /api/projects | Manager, Admin | list projects |
| POST /api/projects | Manager, Admin | create a project + required skills |
| DELETE /api/projects/:id | Admin | remove a project |
| GET /api/projects/:id/candidates | Manager, Admin | ranked matches for that project |
| POST /api/projects/:id/assign | Manager, Admin | staff someone onto a project |
| POST /api/projects/:id/unassign | Manager, Admin | remove them |
| POST /api/search/match | Manager, Admin | manual skill-filter search |
| POST /api/search/ai | Manager, Admin | natural-language search via Ollama |
| GET /api/reports/utilization | Manager, Admin | bench utilization breakdown |
| GET /api/reports/skill-gap | Manager, Admin | required-vs-available skill gaps |
| GET /api/reports/departments | Manager, Admin | headcount by department |
| GET /api/backup/export | Admin | full JSON dump of the database |
| POST /api/backup/import | Admin | restore from a JSON dump |

## Roles

- **Employee** — sees and edits only their own profile.
- **Manager** — read-only roster, search, projects, reports.
- **Admin / HR** — everything, including skill taxonomy management and backups.

Login is name + role, no password — this is a demo auth scheme meant to show
the role-based access pattern. Swap in real authentication (SSO/OAuth, hashed
passwords, etc.) before using this with real company data.

## Known limitations

- Sessions are stored in server memory, so restarting the server logs everyone
  out (their data isn't affected — only the SQLite database persists user data).
- No password/identity verification — anyone can claim any name/role.
- Ollama integration assumes a locally reachable instance; it's not bundled or
  auto-installed.
- Single SQLite file — fine for a team-sized tool, not built for very high
  concurrent write load.
