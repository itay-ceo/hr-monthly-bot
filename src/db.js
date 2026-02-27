const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'reports.db');

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

module.exports = { getDb, saveReport, getReportsForMonth, hasSubmitted };
