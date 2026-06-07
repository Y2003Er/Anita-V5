// session-db.js – Persistent session storage for Baileys v7 using JSONB (ESM)
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
                creds JSONB NOT NULL,
                keys JSONB NOT NULL,
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

async function loadSession(sessionId) {
    const client = await getPool().connect();
    try {
        const res = await client.query(
            `SELECT creds, keys FROM wa_sessions WHERE session_id = $1`,
            [sessionId]
        );
        if (res.rows.length === 0) return null;
        return {
            creds: res.rows[0].creds,
            keys: res.rows[0].keys
        };
    } catch (err) {
        console.error('[session-db] Load error:', err.message);
        return null;
    } finally {
        client.release();
    }
}

async function saveSession(sessionId, creds, keys) {
    const client = await getPool().connect();
    try {
        await client.query(
            `INSERT INTO wa_sessions (session_id, creds, keys, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (session_id) DO UPDATE
             SET creds = EXCLUDED.creds, keys = EXCLUDED.keys, updated_at = NOW()`,
            [sessionId, creds, keys]
        );
        console.log('[session-db] Session saved/updated (JSONB)');
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

// Main auth state for Baileys v7 (with cacheable key store)
export async function usePostgresAuthState(sessionId) {
    const saved = await loadSession(sessionId);
    let creds = saved ? saved.creds : initAuthCreds();
    let keysStore = saved ? saved.keys : {};

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
                await saveSession(sessionId, creds, keysStore);
            }
        }
    };

    const keys = makeCacheableSignalKeyStore(keyStore, null);
    
    const saveCreds = async () => {
        await saveSession(sessionId, creds, keysStore);
        console.log('[session-db] Creds updated (saveCreds)');
    };

    return {
        state: { creds, keys },
        saveCreds
    };
}