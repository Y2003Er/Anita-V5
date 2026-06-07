// session-db.js – inahifadhi state nzima kwenye safu ya 'state' (JSONB)
import { Pool } from 'pg';
import pino from 'pino';
import { initAuthCreds, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';

const logger = pino({ level: 'silent' });

let pool = null;

function getPool() {
    if (pool) return pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL missing');
    pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 5,
        connectionTimeoutMillis: 30000,
    });
    pool.on('error', (err) => console.error('[DB] Pool error:', err.message));
    return pool;
}

// ✅ Rejesha Buffer kutoka JSONB — PostgreSQL inabadilisha Buffer kuwa { type: 'Buffer', data: [...] }
function reviveBuffers(obj) {
    if (obj == null) return obj;

    if (Array.isArray(obj)) {
        return obj.map(reviveBuffers);
    }

    if (typeof obj === 'object') {
        if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
            return Buffer.from(obj.data);
        }

        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = reviveBuffers(value);
        }
        return result;
    }

    return obj;
}

export async function initializeDatabase() {
    const client = await getPool().connect();
    try {
        // ✅ Migration: kama table ipo lakini haina column 'state', drop na uunde upya
        await client.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = 'wa_sessions'
                ) AND NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'wa_sessions' AND column_name = 'state'
                ) THEN
                    DROP TABLE wa_sessions;
                    RAISE NOTICE 'wa_sessions (schema ya zamani) imefutwa — itaundwa upya.';
                END IF;
            END $$;
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS wa_sessions (
                session_id TEXT PRIMARY KEY,
                state JSONB NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('[session-db] Table "wa_sessions" ready (state JSONB).');
        return true;
    } catch (err) {
        console.error('[session-db] Table error:', err.message);
        return false;
    } finally {
        client.release();
    }
}

async function loadState(sessionId) {
    const client = await getPool().connect();
    try {
        const res = await client.query(
            `SELECT state FROM wa_sessions WHERE session_id = $1`,
            [sessionId]
        );
        if (res.rows.length === 0) return null;
        return res.rows[0].state;
    } catch (err) {
        console.error('[session-db] Load error:', err.message);
        return null;
    } finally {
        client.release();
    }
}

async function saveState(sessionId, stateData) {
    const client = await getPool().connect();
    try {
        await client.query(
            `INSERT INTO wa_sessions (session_id, state, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (session_id) DO UPDATE
             SET state = EXCLUDED.state, updated_at = NOW()`,
            [sessionId, stateData]
        );
    } catch (err) {
        console.error('[session-db] Save error:', err.message);
    } finally {
        client.release();
    }
}

export async function deleteSession(sessionId) {
    const client = await getPool().connect();
    try {
        await client.query(`DELETE FROM wa_sessions WHERE session_id = $1`, [sessionId]);
        console.log(`[session-db] Session ${sessionId} deleted`);
    } catch (err) {
        console.error('[session-db] Delete error:', err.message);
    } finally {
        client.release();
    }
}

export async function deleteAllSessions() {
    const client = await getPool().connect();
    try {
        const result = await client.query(`DELETE FROM wa_sessions`);
        console.log(`[session-db] Deleted ${result.rowCount} session(s).`);
    } catch (err) {
        console.error('[session-db] Delete all error:', err.message);
    } finally {
        client.release();
    }
}

// ✅ Main auth state kwa Baileys v7
export async function usePostgresAuthState(sessionId) {
    const fullState = await loadState(sessionId);

    // ✅ reviveBuffers — rejesha Buffer zilizobadilishwa na JSONB serialize
    const creds = reviveBuffers(fullState?.creds) || initAuthCreds();
    let keysStore = reviveBuffers(fullState?.keys) || {};

    const keyStore = {
        get: async (type, ids) => {
            const result = {};
            for (const id of ids) {
                const val = keysStore[`${type}--${id}`];
                if (val !== undefined) result[id] = val;
            }
            return result;
        },
        set: async (data) => {
            let changed = false;
            for (const [type, entries] of Object.entries(data)) {
                if (!entries) continue;
                for (const [id, value] of Object.entries(entries)) {
                    const key = `${type}--${id}`;
                    if (value == null) {
                        if (keysStore[key] !== undefined) {
                            delete keysStore[key];
                            changed = true;
                        }
                    } else {
                        keysStore[key] = value;
                        changed = true;
                    }
                }
            }
            if (changed) {
                await saveState(sessionId, { creds, keys: keysStore });
            }
        },
    };

    const keys = makeCacheableSignalKeyStore(keyStore, logger);

    // ✅ saveCreds iliyoboreshwa
    const saveCreds = async (update) => {
        if (update && typeof update === 'object') {
            Object.assign(creds, update);
        }
        await saveState(sessionId, { creds, keys: keysStore });
        console.log('[session-db] Creds updated & saved.');
    };

    const state = { creds, keys };

    return { state, saveCreds };
}
