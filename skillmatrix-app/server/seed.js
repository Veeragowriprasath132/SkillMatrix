// seed.js — OPTIONAL. Adds sample employees + a starter skill taxonomy for
// testing or practice runs. The database is empty by default; run this only
// if you want sample data (e.g. to rehearse a demo before doing it live with
// real/blank data).
//
// Usage:  node server/seed.js
const db = require('./db');

const empCount = db.prepare('SELECT COUNT(*) AS c FROM employees').get().c;
if (empCount > 0) {
  console.log(`Database already has ${empCount} employee(s). Refusing to seed on top of existing data.`);
  console.log('Delete server/data/skillmatrix.db first if you want a clean seed.');
  process.exit(1);
}

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

console.log(`Seeded ${seedEmployees.length} employees and ${seedTax.length} taxonomy skills.`);
