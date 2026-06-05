/**
 * start.js
 * Startup wrapper for Anita-V5 WhatsApp Bot.
 *
 * Responsibilities:
 *  1. Load environment variables via dotenv.
 *  2. Restore the WhatsApp session from PostgreSQL to the local ./session
 *     directory so that Baileys can pick it up on startup.
 *  3. Hand off execution to the main bot entry-point (index.js).
 *
 * This wrapper exists because index.js is obfuscated and cannot be edited
 * directly. By running `node start.js` instead of `node index.js` we get
 * full DB-backed session persistence without touching the obfuscated code.
 */

'use strict';

require('dotenv').config();

const path = require('path');
const { restoreSessionOnStartup } = require('./session-db');

const SESSION_ID  = process.env.SESSION_DB_ID  || 'anita_v5_session';
const SESSION_DIR = process.env.SESSION_DIR     || path.join(process.cwd(), 'session');

(async () => {
  console.log('[start] Anita-V5 – initialising session persistence...');

  try {
    await restoreSessionOnStartup(SESSION_ID, SESSION_DIR);
  } catch (err) {
    // Non-fatal: log and continue so the bot can still start with local files
    console.error('[start] Session restore failed (continuing anyway):', err.message);
  }

  console.log('[start] Launching bot (index.js)...');

  // Delegate to the main bot module. Using require() keeps the same process
  // so signals, environment variables, and globals are all shared.
  require('./index.js');
})();
