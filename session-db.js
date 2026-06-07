import { Pool } from 'pg';
import { initAuthCreds, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';

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

export async function initializeDatabase() {
    const client = await getPool().connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS wa_sessions (
                session_id TEXT PRIMARY KEY,
                state JSONB NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('[session-db] Table "wa_sessions" ready (JSONB).');
        return true;
    } catch (err) {
        console.error('[session-db] Table creation failed:', err.message);
        return false;
    } finally {
        client.release();
    }
}

async function loadState(sessionId) {
    const client = await getPool().connect();
    try {
        const res = await client.query(`SELECT state FROM wa_sessions WHERE session_id = $1`, [sessionId]);
        if (res.rows.length === 0) return null;
        return res.rows[0].state;
    } catch (err) {
        console.error('[session-db] Load error:', err.message);
        return null;
    } finally {
        client.release();
    }
}

async function saveState(sessionId, state) {
    const client = await getPool().connect();
    try {
        await client.query(
            `INSERT INTO wa_sessions (session_id, state, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (session_id) DO UPDATE
             SET state = EXCLUDED.state, updated_at = NOW()`,
            [sessionId, state]
        );
        console.log('[session-db] State saved');
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
        console.log(`[session-db] Deleted ${result.rowCount} session(s)`);
    } catch (err) {
        console.error('[session-db] Delete all error:', err.message);
    } finally {
        client.release();
    }
}

export async function usePostgresAuthState(sessionId) {
    let saved = await loadState(sessionId);
    let creds = saved?.creds || initAuthCreds();
    let keysStore = saved?.keys || {};

    // Basic key-value store
    const keyStore = {
        get: async (type, ids) => {
            const result = {};
            for (const id of ids) {
                const key = `${type}--${id}`;
                const val = keysStore[key];
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
                    if (value === null || value === undefined) {
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
        }
    };

    const keys = makeCacheableSignalKeyStore(keyStore, null);

    const saveCreds = async () => {
        // creds object is mutated by Baileys, so we save it as is
        await saveState(sessionId, { creds, keys: keysStore });
        console.log('[session-db] Creds updated');
    };

    return {
        state: { creds, keys },
        saveCreds
    };
}