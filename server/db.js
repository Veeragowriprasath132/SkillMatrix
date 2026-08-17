// db.js — SQLite persistence layer using Node's built-in node:sqlite (Node 22+).
// No npm install required.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'skillmatrix.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  designation TEXT DEFAULT '',
  department TEXT DEFAULT '',
  experience REAL DEFAULT 0,
  availability TEXT DEFAULT 'Available'
);

CREATE TABLE IF NOT EXISTS employee_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  level TEXT NOT NULL,
  years REAL
);

CREATE TABLE IF NOT EXISTS skills_taxonomy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT DEFAULT 'Domain Knowledge'
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  client TEXT DEFAULT '',
  status TEXT DEFAULT 'Planning'
);

CREATE TABLE IF NOT EXISTS project_required_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  min_level TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_assignments (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, employee_id)
);
`);

// No automatic seeding — the database starts empty. If you want sample data
// for a demo or testing, run:  node server/seed.js

module.exports = db;
