/**
 * session-db.js
 * PostgreSQL-backed WhatsApp session persistence for Anita-V5.
 *
 * Stores Baileys session data in a `whatsapp_sessions` table so the bot
 * can survive restarts and re-attach to an existing WhatsApp session
 * without requiring a new QR-code scan.
 *
 * Environment variable required:
 *   DATABASE_URL  – PostgreSQL connection string (provided by Railway Postgres)
 *
 * Fallback: when DATABASE_URL is not set the module logs a warning and all
 * operations become no-ops, preserving backward-compatibility with local
 * file-based sessions.
 */

'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ─── Connection pool ──────────────────────────────────────────────────────────

let pool = null;
let dbAvailable = false;

function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('[session-db] DATABASE_URL is not set – falling back to local file sessions.');
    return null;
  }

  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    console.error('[session-db] Unexpected pool error:', err.message);
  });

  return pool;
}

// ─── Schema initialisation ────────────────────────────────────────────────────

/**
 * Creates the `whatsapp_sessions` table if it does not already exist.
 * Safe to call on every startup.
 *
 * @returns {Promise<boolean>} true when the DB is ready, false on failure.
 */
async function initializeDatabase() {
  const p = getPool();
  if (!p) return false;

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_sessions (
        session_id   TEXT        PRIMARY KEY,
        session_data JSONB       NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Index for fast look-ups by session_id (already the PK, but explicit for clarity)
    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_session_id
        ON whatsapp_sessions (session_id);
    `);

    dbAvailable = true;
    console.log('[session-db] Database initialised successfully.');
    return true;
  } catch (err) {
    console.error('[session-db] Failed to initialise database:', err.message);
    dbAvailable = false;
    return false;
  }
}

// ─── CRUD helpers ─────────────────────────────────────────────────────────────

/**
 * Persists (insert-or-update) session data for the given session ID.
 *
 * @param {string} sessionId   Unique identifier for this bot session.
 * @param {object} sessionData Plain-object representation of the Baileys auth state.
 * @returns {Promise<boolean>} true on success.
 */
async function saveSession(sessionId, sessionData) {
  if (!dbAvailable) return false;

  const p = getPool();
  if (!p) return false;

  try {
    await p.query(
      `INSERT INTO whatsapp_sessions (session_id, session_data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (session_id)
         DO UPDATE SET session_data = EXCLUDED.session_data,
                       updated_at   = NOW();`,
      [sessionId, JSON.stringify(sessionData)]
    );
    return true;
  } catch (err) {
    console.error('[session-db] saveSession error:', err.message);
    return false;
  }
}

/**
 * Loads the session data for the given session ID from the database.
 *
 * @param {string} sessionId
 * @returns {Promise<object|null>} Parsed session object, or null if not found / on error.
 */
async function loadSession(sessionId) {
  if (!dbAvailable) return null;

  const p = getPool();
  if (!p) return null;

  try {
    const result = await p.query(
      `SELECT session_data FROM whatsapp_sessions WHERE session_id = $1 LIMIT 1;`,
      [sessionId]
    );

    if (result.rows.length === 0) {
      console.log(`[session-db] No session found for id "${sessionId}".`);
      return null;
    }

    console.log(`[session-db] Session "${sessionId}" loaded from database.`);
    return result.rows[0].session_data;
  } catch (err) {
    console.error('[session-db] loadSession error:', err.message);
    return null;
  }
}

/**
 * Deletes the session record for the given session ID.
 * Useful for forcing a fresh QR-code scan on next startup.
 *
 * @param {string} sessionId
 * @returns {Promise<boolean>} true on success.
 */
async function deleteSession(sessionId) {
  if (!dbAvailable) return false;

  const p = getPool();
  if (!p) return false;

  try {
    await p.query(
      `DELETE FROM whatsapp_sessions WHERE session_id = $1;`,
      [sessionId]
    );
    console.log(`[session-db] Session "${sessionId}" deleted from database.`);
    return true;
  } catch (err) {
    console.error('[session-db] deleteSession error:', err.message);
    return false;
  }
}

// ─── Local-file session helpers ───────────────────────────────────────────────

/**
 * Reads the local session directory and returns its contents as a plain object.
 * Used as a fallback when the database is unavailable, and also to seed the DB
 * on first run.
 *
 * @param {string} sessionDir  Path to the local session folder (default: ./session).
 * @returns {object|null}
 */
function readLocalSession(sessionDir = path.join(process.cwd(), 'session')) {
  try {
    if (!fs.existsSync(sessionDir)) return null;

    const files = fs.readdirSync(sessionDir);
    if (files.length === 0) return null;

    const sessionData = {};
    for (const file of files) {
      const filePath = path.join(sessionDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        sessionData[file] = JSON.parse(content);
      } catch {
        // Skip non-JSON files
      }
    }

    return Object.keys(sessionData).length > 0 ? sessionData : null;
  } catch (err) {
    console.error('[session-db] readLocalSession error:', err.message);
    return null;
  }
}

/**
 * Writes session data back to the local session directory.
 * Used to restore a DB-loaded session to disk so Baileys can read it.
 *
 * @param {object} sessionData
 * @param {string} sessionDir
 */
function writeLocalSession(sessionData, sessionDir = path.join(process.cwd(), 'session')) {
  try {
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    for (const [filename, data] of Object.entries(sessionData)) {
      const filePath = path.join(sessionDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    console.log('[session-db] Session restored to local directory.');
  } catch (err) {
    console.error('[session-db] writeLocalSession error:', err.message);
  }
}

// ─── Startup helper ───────────────────────────────────────────────────────────

/**
 * High-level startup routine:
 *  1. Initialises the database schema.
 *  2. Attempts to load the session from the DB and write it to disk.
 *  3. If no DB session exists but a local session does, seeds the DB from disk.
 *
 * @param {string} sessionId   Identifier used to key the session in the DB.
 * @param {string} sessionDir  Local session directory path.
 * @returns {Promise<void>}
 */
async function restoreSessionOnStartup(
  sessionId = 'anita_v5_session',
  sessionDir = path.join(process.cwd(), 'session')
) {
  const ready = await initializeDatabase();

  if (!ready) {
    console.warn('[session-db] Database unavailable – using local session files only.');
    return;
  }

  // Try to restore session from DB → disk
  const dbSession = await loadSession(sessionId);
  if (dbSession) {
    writeLocalSession(dbSession, sessionDir);
    console.log('[session-db] Session restored from database to local directory.');
    return;
  }

  // No DB session yet – seed from local files if they exist
  const localSession = readLocalSession(sessionDir);
  if (localSession) {
    const saved = await saveSession(sessionId, localSession);
    if (saved) {
      console.log('[session-db] Local session seeded into database for future restarts.');
    }
  } else {
    console.log('[session-db] No existing session found – a new QR code scan will be required.');
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  initializeDatabase,
  saveSession,
  loadSession,
  deleteSession,
  readLocalSession,
  writeLocalSession,
  restoreSessionOnStartup,
};
