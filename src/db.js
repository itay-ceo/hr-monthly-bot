const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'hr-bot.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        sick_days REAL NOT NULL,
        vacation_days REAL NOT NULL,
        submitted_at TEXT NOT NULL,
        UNIQUE(user_id, month, year)
      )
    `);

    // Migration: drop attendance_days column if it exists (from older schema)
    const columns = db.prepare("PRAGMA table_info(reports)").all();
    if (columns.some(c => c.name === 'attendance_days')) {
      console.log('[DB] Migrating: removing attendance_days column');
      db.exec(`
        CREATE TABLE reports_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL,
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          sick_days REAL NOT NULL,
          vacation_days REAL NOT NULL,
          submitted_at TEXT NOT NULL,
          UNIQUE(user_id, month, year)
        );
        INSERT INTO reports_new (id, user_id, user_name, month, year, sick_days, vacation_days, submitted_at)
          SELECT id, user_id, user_name, month, year, sick_days, vacation_days, submitted_at FROM reports;
        DROP TABLE reports;
        ALTER TABLE reports_new RENAME TO reports;
      `);
      console.log('[DB] Migration complete');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS active_period (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        month INTEGER NOT NULL,
        year INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS employees (
        user_id TEXT PRIMARY KEY,
        added_at TEXT NOT NULL
      )
    `);

    // One-time seed: if employees table is empty and EMPLOYEE_IDS env var is set, import them
    const count = db.prepare('SELECT COUNT(*) AS cnt FROM employees').get().cnt;
    if (count === 0) {
      const envIds = process.env.EMPLOYEE_IDS;
      if (envIds && envIds.trim()) {
        const ids = envIds.split(',').map(s => s.trim()).filter(Boolean);
        const insert = db.prepare('INSERT OR IGNORE INTO employees (user_id, added_at) VALUES (?, ?)');
        const now = new Date().toISOString();
        for (const id of ids) {
          insert.run(id, now);
        }
        console.log(`[DB] Seeded ${ids.length} employees from EMPLOYEE_IDS env var`);
      }
    }

    console.log('[DB] Database initialized');
  }
  return db;
}

function saveReport({ userId, userName, month, year, sickDays, vacationDays }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO reports (user_id, user_name, month, year, sick_days, vacation_days, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, month, year)
    DO UPDATE SET
      user_name = excluded.user_name,
      sick_days = excluded.sick_days,
      vacation_days = excluded.vacation_days,
      submitted_at = excluded.submitted_at
  `);

  stmt.run(userId, userName, month, year, sickDays, vacationDays, new Date().toISOString());
}

function getReportsForMonth(month, year) {
  const db = getDb();
  return db.prepare('SELECT * FROM reports WHERE month = ? AND year = ?').all(month, year);
}

function hasSubmitted(userId, month, year) {
  const db = getDb();
  const row = db.prepare('SELECT id FROM reports WHERE user_id = ? AND month = ? AND year = ?').get(userId, month, year);
  return !!row;
}

function addEmployee(userId) {
  const db = getDb();
  const result = db.prepare('INSERT OR IGNORE INTO employees (user_id, added_at) VALUES (?, ?)').run(userId, new Date().toISOString());
  return result.changes > 0;
}

function removeEmployee(userId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM employees WHERE user_id = ?').run(userId);
  return result.changes > 0;
}

function getEmployeeIds() {
  const db = getDb();
  return db.prepare('SELECT user_id FROM employees').all().map(r => r.user_id);
}

function isEmployeeTablePopulated() {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) AS cnt FROM employees').get().cnt > 0;
}

function setActivePeriod(month, year) {
  const db = getDb();
  db.prepare(`
    INSERT INTO active_period (id, month, year, updated_at) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET month = excluded.month, year = excluded.year, updated_at = excluded.updated_at
  `).run(month, year, new Date().toISOString());
}

function getActivePeriod() {
  const db = getDb();
  return db.prepare('SELECT month, year FROM active_period WHERE id = 1').get() || null;
}

function deleteReportsForMonth(month, year) {
  const db = getDb();
  return db.prepare('DELETE FROM reports WHERE month = ? AND year = ?').run(month, year).changes;
}

module.exports = { getDb, saveReport, getReportsForMonth, hasSubmitted, addEmployee, removeEmployee, getEmployeeIds, isEmployeeTablePopulated, setActivePeriod, getActivePeriod, deleteReportsForMonth };
