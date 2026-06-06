// session-db.js – with verbose logging and safe binary handling
'use strict';

const { Pool } = require('pg');
const { initAuthCreds, proto } = require('@whiskeysockets/baileys');

let pool = null;

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
        connectionTimeoutMillis: 30000,
    });
    pool.on('error', (err) => console.error('[session-db] Pool error:', err.message));
    return pool;
}

// Serialize Buffers to base64
function toSerializable(obj) {
    if (Buffer.isBuffer(obj)) {
        return { __type: 'Buffer', data: obj.toString('base64') };
    }
    if (obj && typeof obj === 'object') {
        if (Array.isArray(obj)) return obj.map(toSerializable);
        const copy = {};
        for (const [k, v] of Object.entries(obj)) {
            copy[k] = toSerializable(v);
        }
        return copy;
    }
    return obj;
}

function fromSerializable(obj) {
    if (obj && typeof obj === 'object') {
        if (obj.__type === 'Buffer' && typeof obj.data === 'string') {
            return Buffer.from(obj.data, 'base64');
        }
        if (Array.isArray(obj)) return obj.map(fromSerializable);
        for (const k in obj) {
            obj[k] = fromSerializable(obj[k]);
        }
    }
    return obj;
}

async function initializeDatabase() {
    const p = getPool();
    try {
        await p.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_sessions (
                session_id TEXT NOT NULL,
                file_key TEXT NOT NULL,
                session_data JSONB NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (session_id, file_key)
            )
        `);
        console.log('[session-db] ✅ Table ipo tayari');
        return true;
    } catch (err) {
        console.error('[session-db] ❌ Table creation failed:', err.message);
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
        const raw = res.rows[0].session_data;
        return fromSerializable(raw);
    } catch (err) {
        console.error(`[session-db] dbGet error (${fileKey}):`, err.message);
        return null;
    }
}

async function dbSet(sessionId, fileKey, value) {
    const p = getPool();
    const serialized = toSerializable(value);
    try {
        await p.query(`
            INSERT INTO whatsapp_sessions (session_id, file_key, session_data, updated_at)
            VALUES ($1, $2, $3::jsonb, NOW())
            ON CONFLICT (session_id, file_key) DO UPDATE
            SET session_data = EXCLUDED.session_data, updated_at = NOW()
        `, [sessionId, fileKey, JSON.stringify(serialized)]);
        console.log(`[session-db] ✅ ${fileKey} saved`);
    } catch (err) {
        console.error(`[session-db] ❌ ${fileKey} failed:`, err.message);
    }
}

async function dbDel(sessionId, fileKey) {
    const p = getPool();
    try {
        await p.query(`DELETE FROM whatsapp_sessions WHERE session_id = $1 AND file_key = $2`, [sessionId, fileKey]);
        console.log(`[session-db] 🗑️ ${fileKey} deleted`);
    } catch (err) {
        console.error(`[session-db] dbDel error:`, err.message);
    }
}

async function usePostgresAuthState(sessionId) {
    let creds = await dbGet(sessionId, 'creds');
    if (!creds) {
        creds = initAuthCreds();
        await dbSet(sessionId, 'creds', creds);
        console.log('[session-db] 🆕 New session created, pairing required');
    } else {
        console.log('[session-db] ♻️ Existing session found, reusing');
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
        console.log('[session-db] 💾 Creds saved after update');
    };

    return { state: { creds, keys }, saveCreds };
}

async function deleteSession(sessionId) {
    try {
        await getPool().query(`DELETE FROM whatsapp_sessions WHERE session_id = $1`, [sessionId]);
        console.log(`[session-db] 🗑️ Session ${sessionId} deleted`);
    } catch (err) {
        console.error('[session-db] delete error:', err.message);
    }
}

module.exports = {
    initializeDatabase,
    usePostgresAuthState,
    deleteSession,
};