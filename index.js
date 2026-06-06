'use strict';
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const pino = require('pino');
const { Pool } = require('pg');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    initAuthCreds,
    BufferJSON,
} = require('@whiskeysockets/baileys');

const logger = pino({ level: 'silent' });

const PHONE_NUMBER = process.env.PHONE_NUMBER?.trim();
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        )
    `);
    console.log('✅ Database iko tayari');
}

async function usePostgreSQLAuthState() {
    await initDB();

    const writeData = async (id, data) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await pool.query(
            `INSERT INTO auth_sessions (id, data) VALUES ($1, $2)
             ON CONFLICT (id) DO UPDATE SET data = $2`,
            [id, json]
        );
    };

    const readData = async (id) => {
        const result = await pool.query(
            'SELECT data FROM auth_sessions WHERE id = $1',
            [id]
        );
        if (result.rows.length === 0) return null;
        return JSON.parse(result.rows[0].data, BufferJSON.reviver);
    };

    const removeData = async (id) => {
        await pool.query('DELETE FROM auth_sessions WHERE id = $1', [id]);
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                // ✅ FIXED (Baileys correct format)
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        const value = await readData(`${type}-${id}`);
                        if (value) data[id] = value;
                    }));
                    return data;
                },

                // ✅ FIXED (safe structure)
                set: async (data) => {
                    await Promise.all(
                        Object.entries(data).map(async ([type, values]) => {
                            await Promise.all(
                                Object.entries(values).map(([id, value]) => {
                                    const key = `${type}-${id}`;
                                    return value
                                        ? writeData(key, value)
                                        : removeData(key);
                                })
                            );
                        })
                    );
                },
            },
        },

        // ❗ FIXED (creds must update dynamically)
        saveCreds: () => writeData('creds', creds),
    };
}

console.log('==============================');
console.log('  26 TECH SOLUTION STARTING  ');
console.log('==============================');

if (!PHONE_NUMBER) {
    console.log('❌ PHONE_NUMBER haipo kwenye .env');
    process.exit(1);
}

if (!DATABASE_URL) {
    console.log('❌ DATABASE_URL haipo kwenye .env');
    process.exit(1);
}

let sock = null;
let isConnecting = false;
let pairingRequested = false;
let bootLock = false;
let openTimer = null;
let retryDelay = 7000;

function clearOpenTimer() {
    if (openTimer) {
        clearTimeout(openTimer);
        openTimer = null;
    }
}

function displayPairingCode(code) {
    console.log('\n╔══════════════════════════╗');
    console.log('║   🔑 PAIRING CODE        ║');
    console.log('╠══════════════════════════╣');
    console.log(`║      ${code}      ║`);
    console.log('╚══════════════════════════╝');
    console.log(`\n📋 CODE: ${code}\n`);
    console.log('👆 WhatsApp → Linked Devices → Link a Device');
    console.log('👆 Link with phone number → Weka namba yako');
    console.log('👆 Popup itatokea yenyewe — bonyeza CONFIRM\n');
}

async function startBot() {
    if (bootLock || isConnecting) return;
    bootLock = true;
    isConnecting = true;
    pairingRequested = false;
    clearOpenTimer();

    try {
        const { state, saveCreds } = await usePostgreSQLAuthState();
        const { version } = await fetchLatestBaileysVersion();

        if (sock) {
            try {
                sock.ev.removeAllListeners();
                sock.ws?.close();
            } catch {}
            sock = null;
        }

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '120.0.0'],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            console.log('🔄 State:', connection ?? 'connecting');

            // FIX: avoid multiple pairing triggers
            if (!pairingRequested && !state.creds.registered && connection && connection !== 'close') {
                pairingRequested = true;

                setTimeout(async () => {
                    try {
                        console.log(`📱 Inaomba pairing code kwa: ${PHONE_NUMBER}`);
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        displayPairingCode(code);
                    } catch (err) {
                        console.error('❌ Pairing code error:', err.message);
                        pairingRequested = false;
                    }
                }, 3000);
            }

            if (connection === 'open') {
                clearOpenTimer();
                retryDelay = 7000;

                console.log('🟢 BOT ONLINE SUCCESSFULLY!');
                isConnecting = false;
                bootLock = false;
            }

            if (connection === 'close') {
                clearOpenTimer();

                const statusCode = lastDisconnect?.error?.output?.statusCode;

                console.log('\n════ DISCONNECT INFO ════');
                console.log('Code:', statusCode);
                console.log(JSON.stringify(lastDisconnect?.error?.output, null, 2));
                console.log('════════════════════════\n');

                isConnecting = false;
                bootLock = false;

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('❌ Logged out - clearing DB session');
                    await pool.query('DELETE FROM auth_sessions');
                    retryDelay = 7000;
                } else if (statusCode === 401) {
                    console.log('⚠️ 401 - retry delayed');
                    retryDelay = 15000;
                }

                setTimeout(startBot, retryDelay);
            }
        });

        openTimer = setTimeout(() => {
            console.log('⏰ Timeout restart...');
            isConnecting = false;
            bootLock = false;

            if (sock) {
                try {
                    sock.ev.removeAllListeners();
                    sock.ws?.close();
                } catch {}
            }

            setTimeout(startBot, retryDelay);
        }, 120000);

        if (state.creds.registered) {
            console.log('✅ Session ipo kwenye DB');
        } else {
            console.log('⏳ Session mpya - inasubiri pairing...');
        }

    } catch (err) {
        console.error('BOT ERROR:', err);
        isConnecting = false;
        bootLock = false;
        clearOpenTimer();
        setTimeout(startBot, retryDelay);
    }
}

startBot();