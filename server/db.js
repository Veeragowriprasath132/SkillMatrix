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

// ---- Seed on first run ----
const empCount = db.prepare('SELECT COUNT(*) AS c FROM employees').get().c;
if (empCount === 0) {
  const seedEmployees = [
    { name: "Priya Raman", designation: "Senior Software Engineer", department: "Cloud Engineering", experience: 5, availability: "Available",
      skills: [["React","Advanced",4],["Node.js","Advanced",4],["AWS","Intermediate",2],["PostgreSQL","Intermediate",3]] },
    { name: "Arjun Mehta", designation: "DevOps Engineer", department: "Platform", experience: 4, availability: "Partial",
      skills: [["AWS","Expert",5],["Kubernetes","Advanced",3],["Terraform","Advanced",3],["Python","Intermediate",2]] },
    { name: "Sneha Iyer", designation: "Data Analyst", department: "Analytics", experience: 3, availability: "Available",
      skills: [["Python","Advanced",3],["SQL","Expert",4],["Tableau","Advanced",2],["Statistics","Intermediate",2]] },
    { name: "Rahul Verma", designation: "Full Stack Developer", department: "Product Engineering", experience: 6, availability: "Allocated",
      skills: [["React","Expert",6],["Node.js","Expert",6],["AWS","Advanced",3],["MongoDB","Advanced",3]] },
    { name: "Divya Nair", designation: "QA Lead", department: "Quality", experience: 7, availability: "Available",
      skills: [["Selenium","Expert",6],["Java","Advanced",5],["SQL","Intermediate",3],["AWS","Beginner",1]] }
  ];
  const insEmp = db.prepare('INSERT INTO employees (name,designation,department,experience,availability) VALUES (?,?,?,?,?)');
  const insSkill = db.prepare('INSERT INTO employee_skills (employee_id,skill_name,level,years) VALUES (?,?,?,?)');
  for (const e of seedEmployees) {
    const res = insEmp.run(e.name, e.designation, e.department, e.experience, e.availability);
    const empId = Number(res.lastInsertRowid);
    for (const [name, level, years] of e.skills) insSkill.run(empId, name, level, years);
  }

  const seedTax = [
    ["React","Framework & Library"],["Node.js","Framework & Library"],["AWS","Cloud & DevOps"],
    ["PostgreSQL","Database"],["Kubernetes","Cloud & DevOps"],["Terraform","Cloud & DevOps"],
    ["Python","Programming Language"],["SQL","Database"],["Tableau","Data & Analytics"],
    ["Statistics","Data & Analytics"],["MongoDB","Database"],["Selenium","Testing & QA"],["Java","Programming Language"]
  ];
  const insTax = db.prepare('INSERT INTO skills_taxonomy (name,category) VALUES (?,?)');
  for (const [name, category] of seedTax) insTax.run(name, category);
}

module.exports = db;
