'use strict';

const { Pool } = require('pg');
const {
    initAuthCreds,
    proto,
} = require('@whiskeysockets/baileys');

// ─── Connection pool ──────────────────────────────────────────────────────────

let pool = null;
let dbAvailable = false;

function getPool() {
    if (pool) return pool;

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('[session-db] DATABASE_URL haipo — Bot imesimama.');
        process.exit(1);
    }

    pool = new Pool({
        connectionString,
        ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });

    pool.on('error', (err) => {
        console.error('[session-db] Pool error:', err.message);
    });

    return pool;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

async function initializeDatabase() {
    const p = getPool();
    if (!p) return false;

    try {
        // Kila faili ya session inahifadhiwa kama row yake — rahisi na salama
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

// ─── Low-level helpers ────────────────────────────────────────────────────────

async function dbGet(sessionId, fileKey) {
    const p = getPool();
    try {
        const res = await p.query(
            `SELECT session_data FROM whatsapp_sessions
             WHERE session_id = $1 AND file_key = $2 LIMIT 1`,
            [sessionId, fileKey]
        );
        return res.rows.length > 0 ? res.rows[0].session_data : null;
    } catch (err) {
        console.error(`[session-db] dbGet error (${fileKey}):`, err.message);
        return null;
    }
}

async function dbSet(sessionId, fileKey, value) {
    const p = getPool();
    try {
        await p.query(`
            INSERT INTO whatsapp_sessions (session_id, file_key, session_data, updated_at)
            VALUES ($1, $2, $3::jsonb, NOW())
            ON CONFLICT (session_id, file_key)
            DO UPDATE SET session_data = EXCLUDED.session_data,
                          updated_at   = NOW()
        `, [sessionId, fileKey, JSON.stringify(value)]);
    } catch (err) {
        console.error(`[session-db] dbSet error (${fileKey}):`, err.message);
    }
}

async function dbDel(sessionId, fileKey) {
    const p = getPool();
    try {
        await p.query(
            `DELETE FROM whatsapp_sessions WHERE session_id = $1 AND file_key = $2`,
            [sessionId, fileKey]
        );
    } catch (err) {
        console.error(`[session-db] dbDel error (${fileKey}):`, err.message);
    }
}

// ─── usePostgresAuthState ─────────────────────────────────────────────────────

async function usePostgresAuthState(sessionId) {

    // Soma creds — hifadhi kama row yake mwenyewe
    let creds = await dbGet(sessionId, 'creds');
    if (!creds) {
        creds = initAuthCreds();
        // Hifadhi mara moja creds mpya
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
                const val = await dbGet(sessionId, fileKey);
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
                        return value
                            ? dbSet(sessionId, fileKey, value)
                            : dbDel(sessionId, fileKey);
                    })
                )
            );
        },
    };

    // saveCreds — MUHIMU: hifadhi creds zilizobadilika mara moja
    const saveCreds = async () => {
        await dbSet(sessionId, 'creds', creds);
        console.log('[session-db] ✔ Creds zimehifadhiwa DB.');
    };

    return {
        state: { creds, keys },
        saveCreds,
    };
}

// ─── Session management ───────────────────────────────────────────────────────

async function deleteSession(sessionId) {
    if (!dbAvailable) return false;
    const p = getPool();
    try {
        await p.query(
            `DELETE FROM whatsapp_sessions WHERE session_id = $1`,
            [sessionId]
        );
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
            `SELECT 1 FROM whatsapp_sessions
             WHERE session_id = $1 AND file_key = 'creds' LIMIT 1`,
            [sessionId]
        );
        return res.rows.length > 0;
    } catch {
        return false;
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    initializeDatabase,
    usePostgresAuthState,
    deleteSession,
    sessionExistsInDB,
};
