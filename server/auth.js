// auth.js — lightweight token-based sessions (in-memory).
// This is a demo auth scheme: name + chosen role, no password. Good enough for an
// internal prototype; swap in real authentication (SSO/OAuth) before production use.
const crypto = require('node:crypto');
const db = require('./db');

const sessions = new Map(); // token -> { name, role, employeeId }

function createSession({ name, role, employeeId }) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { name, role, employeeId });
  return token;
}

function getSession(token) {
  return sessions.get(token) || null;
}

function destroySession(token) {
  sessions.delete(token);
}

function findEmployeeByName(name) {
  return db.prepare('SELECT * FROM employees WHERE LOWER(name) = LOWER(?)').get(name);
}

function ensureEmployeeForLogin(name) {
  let emp = findEmployeeByName(name);
  if (!emp) {
    const res = db.prepare(
      'INSERT INTO employees (name,designation,department,experience,availability) VALUES (?,?,?,?,?)'
    ).run(name, '', '', 0, 'Available');
    emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(Number(res.lastInsertRowid));
  }
  return emp;
}

// Extract bearer token from request headers
function tokenFromReq(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

module.exports = { createSession, getSession, destroySession, ensureEmployeeForLogin, tokenFromReq };
