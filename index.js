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

// ✅ PostgreSQL connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// ✅ Unda table kama haipo
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        )
    `);
    console.log('✅ Database iko tayari');
}

// ✅ Custom auth state inayotumia PostgreSQL
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
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            const value = await readData(`${type}-${id}`);
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    await Promise.all(
                        Object.entries(data).flatMap(([type, ids]) =>
                            Object.entries(ids).map(([id, value]) =>
                                value
                                    ? writeData(`${type}-${id}`, value)
                                    : removeData(`${type}-${id}`)
                            )
                        )
                    );
                },
            },
        },
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

            console.log('🔄 State:', connection ?? 'connecting...');

            if (!pairingRequested && !state.creds.registered && connection !== 'close') {
                setTimeout(async () => {
                    if (pairingRequested) return;
                    try {
                        pairingRequested = true;
                        console.log(`📱 Inaomba pairing code kwa: ${PHONE_NUMBER}`);
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        displayPairingCode(code);
                    } catch (err) {
                        console.error('❌ Pairing code imeshindwa:', err.message);
                        pairingRequested = false;
                    }
                }, 3000);
            }

            if (connection === 'open') {
                clearOpenTimer();
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

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('❌ Session invalid. Inafuta na kuanza upya...');
                    await pool.query('DELETE FROM auth_sessions');
                }

                setTimeout(startBot, 7000);
            }
        });

        // ✅ MESSAGE HANDLER
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg.message) return;
            if (msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const text = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text || '';

            console.log(`📩 Ujumbe kutoka ${from}: ${text}`);

            if (text.toLowerCase() === 'ping') {
                await sock.sendMessage(from, { text: '🏓 Pong! Bot iko active!' });

            } else if (text.toLowerCase() === 'hello' || text.toLowerCase() === 'hujambo') {
                await sock.sendMessage(from, {
                    text: '👋 Habari! Mimi ni *26 Tech Solution* 🤖\nPowered by *Yuzzo*\nNikusaidie nini?'
                });

            } else if (text.toLowerCase() === '!help') {
                await sock.sendMessage(from, {
                    text: `🤖 *26 TECH SOLUTION BOT*\n` +
                          `Powered by *Yuzzo*\n\n` +
                          `📋 *COMMANDS ZINAZOPATIKANA:*\n\n` +
                          `• ping — Test bot\n` +
                          `• hello / hujambo — Salamu\n` +
                          `• !help — Orodha ya commands`
                });
            }
        });

        openTimer = setTimeout(() => {
            console.log('⏰ Haikufunguka kwa sekunde 90. Restarting...');
            isConnecting = false;
            bootLock = false;

            if (sock) {
                try {
                    sock.ev.removeAllListeners();
                    sock.ws?.close();
                } catch {}
            }

            setTimeout(startBot, 7000);
        }, 90000);

        if (state.creds.registered) {
            console.log('✅ Session ipo kwenye database. Inaunganisha...');
        } else {
            console.log('⏳ Session mpya. Inasubiri pairing code...');
        }

    } catch (err) {
        console.error('BOT ERROR:', err);
        isConnecting = false;
        bootLock = false;
        clearOpenTimer();
        setTimeout(startBot, 7000);
    }
}

startBot();
