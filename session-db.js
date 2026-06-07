// session-db.js – Fully compatible with Baileys v7 (^7.0.0-rc13)
// Fixes decryption errors by properly storing all key types (including sender-key)
'use strict';

const { Pool } = require('pg');
const { initAuthCreds, proto } = require('@whiskeysockets/baileys');

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

// ========== Robust Serialization (handles Buffers & Proto objects) ==========
function toSerializable(obj) {
    if (obj === null || obj === undefined) return obj;
    if (Buffer.isBuffer(obj)) {
        return { __type: 'Buffer', data: obj.toString('base64') };
    }
    // Handle proto objects that have toJSON method
    if (typeof obj.toJSON === 'function') {
        return toSerializable(obj.toJSON());
    }
    if (Array.isArray(obj)) {
        return obj.map(v => toSerializable(v));
    }
    if (typeof obj === 'object') {
        const copy = {};
        for (const [k, v] of Object.entries(obj)) {
            copy[k] = toSerializable(v);
        }
        return copy;
    }
    return obj;
}

function fromSerializable(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'object') {
        if (obj.__type === 'Buffer' && typeof obj.data === 'string') {
            return Buffer.from(obj.data, 'base64');
        }
        if (Array.isArray(obj)) {
            return obj.map(v => fromSerializable(v));
        }
        const copy = {};
        for (const [k, v] of Object.entries(obj)) {
            copy[k] = fromSerializable(v);
        }
        return copy;
    }
    return obj;
}

// ========== Initialize table ==========
async function initializeDatabase() {
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
        console.log('[session-db] Table "wa_sessions" ready.');
        return true;
    } catch (err) {
        console.error('[session-db] Table creation failed:', err.message);
        return false;
    } finally {
        client.release();
    }
}

// ========== Load session ==========
async function loadSession(sessionId) {
    const client = await getPool().connect();
    try {
        const res = await client.query(
            `SELECT creds, keys FROM wa_sessions WHERE session_id = $1`,
            [sessionId]
        );
        if (res.rows.length === 0) return null;
        const creds = fromSerializable(res.rows[0].creds);
        const keys = fromSerializable(res.rows[0].keys);
        return { creds, keys };
    } catch (err) {
        console.error('[session-db] Load error:', err.message);
        return null;
    } finally {
        client.release();
    }
}

// ========== Save session ==========
async function saveSession(sessionId, creds, keys) {
    const client = await getPool().connect();
    try {
        const credsJson = toSerializable(creds);
        const keysJson = toSerializable(keys);
        await client.query(
            `INSERT INTO wa_sessions (session_id, creds, keys, updated_at)
             VALUES ($1, $2::jsonb, $3::jsonb, NOW())
             ON CONFLICT (session_id) DO UPDATE
             SET creds = EXCLUDED.creds, keys = EXCLUDED.keys, updated_at = NOW()`,
            [sessionId, JSON.stringify(credsJson), JSON.stringify(keysJson)]
        );
        console.log('[session-db] Session saved/updated');
    } catch (err) {
        console.error('[session-db] Save error:', err.message);
    } finally {
        client.release();
    }
}

// ========== Delete session ==========
async function deleteSession(sessionId) {
    const client = await getPool().connect();
    try {
        await client.query(`DELETE FROM wa_sessions WHERE session_id = $1`, [sessionId]);
        console.log('[session-db] Session deleted');
    } catch (err) {
        console.error('[session-db] Delete error:', err.message);
    } finally {
        client.release();
    }
}

// ========== Helper to deserialize app-state-sync-key (v7) ==========
function deserializeAppStateSyncKey(data) {
    if (proto.Message?.AppStateSyncKeyData?.fromObject) {
        return proto.Message.AppStateSyncKeyData.fromObject(data);
    }
    if (proto.AppStateSyncKeyData?.fromObject) {
        return proto.AppStateSyncKeyData.fromObject(data);
    }
    // Last resort: assume it's already a proper object
    return data;
}

// ========== Main auth state for Baileys v7 ==========
async function usePostgresAuthState(sessionId) {
    let session = await loadSession(sessionId);
    let creds = session ? session.creds : initAuthCreds();
    let keysStore = session ? session.keys : {};

    const keys = {
        get: async (type, ids) => {
            const result = {};
            for (const id of ids) {
                const key = `${type}--${id}`;
                const val = keysStore[key];
                if (val !== undefined) {
                    if (type === 'app-state-sync-key') {
                        result[id] = deserializeAppStateSyncKey(val);
                    } else {
                        // For all other types (pre-key, session, sender-key, etc.)
                        result[id] = val;
                    }
                }
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
                        // Convert any proto object to plain JSON-serializable form
                        let toStore = value;
                        if (value && typeof value.toJSON === 'function') {
                            toStore = value.toJSON();
                        } else if (value && typeof value === 'object') {
                            // Already plain object – but we need to ensure nested Buffers are handled
                            toStore = toSerializable(value);
                        }
                        keysStore[key] = toStore;
                        changed = true;
                    }
                }
            }
            if (changed) {
                await saveSession(sessionId, creds, keysStore);
            }
        }
    };

    const saveCreds = async () => {
        await saveSession(sessionId, creds, keysStore);
        console.log('[session-db] Creds updated (saveCreds)');
    };

    return { state: { creds, keys }, saveCreds };
}

module.exports = {
    initializeDatabase,
    usePostgresAuthState,
    deleteSession,
};