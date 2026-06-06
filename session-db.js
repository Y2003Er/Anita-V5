// session-db.js – Fixed version with binary serialization (base64)
'use strict';

const { Pool } = require('pg');
const { initAuthCreds, proto } = require('@whiskeysockets/baileys');

let pool = null;
let dbAvailable = false;

function getPool() {
    if (pool) return pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('[session-db] DATABASE_URL haipo');
        process.exit(1);
    }
    pool = new Pool({
        connectionString,
        ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000, // increased for public URL
    });
    pool.on('error', (err) => console.error('[session-db] Pool error:', err.message));
    return pool;
}

// ========== Serialization helpers for Buffer ==========
function toSerializable(value) {
    if (Buffer.isBuffer(value)) {
        return { __type: 'Buffer', data: value.toString('base64') };
    }
    if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
            return value.map(v => toSerializable(v));
        }
        const copy = {};
        for (const [k, v] of Object.entries(value)) {
            copy[k] = toSerializable(v);
        }
        return copy;
    }
    return value;
}

function fromSerializable(value) {
    if (value && typeof value === 'object') {
        if (value.__type === 'Buffer' && typeof value.data === 'string') {
            return Buffer.from(value.data, 'base64');
        }
        if (Array.isArray(value)) {
            return value.map(v => fromSerializable(v));
        }
        for (const k in value) {
            value[k] = fromSerializable(value[k]);
        }
    }
    return value;
}

// ========== Database operations ==========
async function initializeDatabase() {
    const p = getPool();
    try {
        await p.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_sessions (
                session_id   TEXT        NOT NULL,
                file_key     TEXT        NOT NULL,
                session_data JSONB       NOT NULL,
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (session_id, file_key)
            );
        `);
        dbAvailable = true;
        console.log('[session-db] ✔ Database tayari.');
        return true;
    } catch (err) {
        console.error('[session-db] Kuanzisha DB kumeshindwa:', err.message);
        dbAvailable = false;
        return false;
    }
}

async function dbGet(sessionId, fileKey) {
    const p = getPool();
    try {
        const res = await p.query(
            `SELECT session_data FROM whatsapp_sessions WHERE session_id = $1 AND file_key = $2`,
            [sessionId, fileKey]
        );
        if (!res.rows.length) return null;
        // Deserialize: convert base64 back to Buffer
        return fromSerializable(res.rows[0].session_data);
    } catch (err) {
        console.error(`[session-db] dbGet error (${fileKey}):`, err.message);
        return null;
    }
}

async function dbSet(sessionId, fileKey, value) {
    const p = getPool();
    // Serialize: convert Buffers to base64
    const serialized = toSerializable(value);
    try {
        await p.query(`
            INSERT INTO whatsapp_sessions (session_id, file_key, session_data, updated_at)
            VALUES ($1, $2, $3::jsonb, NOW())
            ON CONFLICT (session_id, file_key) DO UPDATE
            SET session_data = EXCLUDED.session_data, updated_at = NOW()
        `, [sessionId, fileKey, JSON.stringify(serialized)]);
    } catch (err) {
        console.error(`[session-db] dbSet error (${fileKey}):`, err.message);
    }
}

async function dbDel(sessionId, fileKey) {
    const p = getPool();
    try {
        await p.query(`DELETE FROM whatsapp_sessions WHERE session_id = $1 AND file_key = $2`, [sessionId, fileKey]);
    } catch (err) {
        console.error(`[session-db] dbDel error (${fileKey}):`, err.message);
    }
}

// ========== Baileys auth state ==========
async function usePostgresAuthState(sessionId) {
    let creds = await dbGet(sessionId, 'creds');
    if (!creds) {
        creds = initAuthCreds();
        await dbSet(sessionId, 'creds', creds);
        console.log('[session-db] Session mpya — Inahitaji pairing.');
    } else {
        console.log('[session-db] ✔ Session inapatikana DB — Inaunganika...');
    }

    const keys = {
        get: async (type, ids) => {
            const data = {};
            await Promise.all(ids.map(async (id) => {
                const fileKey = `${type}--${id}`;
                let val = await dbGet(sessionId, fileKey);
                if (val) {
                    if (type === 'app-state-sync-key') {
                        data[id] = proto.Message.AppStateSyncKeyData.fromObject(val);
                    } else {
                        data[id] = val;
                    }
                }
            }));
            return data;
        },
        set: async (data) => {
            await Promise.all(
                Object.entries(data).flatMap(([type, ids]) =>
                    Object.entries(ids ?? {}).map(([id, value]) => {
                        const fileKey = `${type}--${id}`;
                        return value ? dbSet(sessionId, fileKey, value) : dbDel(sessionId, fileKey);
                    })
                )
            );
        },
    };

    const saveCreds = async () => {
        await dbSet(sessionId, 'creds', creds);
        console.log('[session-db] ✔ Creds zimehifadhiwa DB.');
    };

    return { state: { creds, keys }, saveCreds };
}

async function deleteSession(sessionId) {
    if (!dbAvailable) return false;
    try {
        await getPool().query(`DELETE FROM whatsapp_sessions WHERE session_id = $1`, [sessionId]);
        console.log(`[session-db] Session "${sessionId}" imefutwa DB.`);
        return true;
    } catch (err) {
        console.error('[session-db] deleteSession error:', err.message);
        return false;
    }
}

async function sessionExistsInDB(sessionId) {
    if (!dbAvailable) return false;
    try {
        const res = await getPool().query(
            `SELECT 1 FROM whatsapp_sessions WHERE session_id = $1 AND file_key = 'creds' LIMIT 1`,
            [sessionId]
        );
        return res.rows.length > 0;
    } catch { return false; }
}

module.exports = {
    initializeDatabase,
    usePostgresAuthState,
    deleteSession,
    sessionExistsInDB,
};