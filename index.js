'use strict';

const dotenv = require('dotenv');
dotenv.config();

const pino = require('pino');
const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const {
    initializeDatabase,
    usePostgresAuthState,
    deleteSession,
} = require('./session-db');

const logger = pino({ level: 'silent' });

const SESSION_ID   = process.env.SESSION_ID || 'queen_anita_v5';
const PHONE_NUMBER = process.env.PHONE_NUMBER?.trim();

// ─── Logger ─────────────────────────────────────────
const log = {
    info:    (msg) => console.log(`  ✦  ${msg}`),
    success: (msg) => console.log(`  ✔  ${msg}`),
    warn:    (msg) => console.log(`  ⚠  ${msg}`),
    error:   (msg) => console.log(`  ✖  ${msg}`),
    state:   (msg) => console.log(`  ◈  ${msg}`),
    div:     ()    => console.log(`  ${'─'.repeat(46)}`),
    blank:   ()    => console.log(''),
};

// ─── Banner ─────────────────────────────────────────
log.blank();
console.log('  ╔════════════════════════════════════════════╗');
console.log('  ║       QUEEN_ANITA-V5   ·   RUNTIME         ║');
console.log('  ║       WhatsApp Bot   ·   Baileys           ║');
console.log('  ║       Session  ·   PostgreSQL (Railway)    ║');
console.log('  ╚════════════════════════════════════════════╝');
log.blank();

// ─── Validations ─────────────────────────────────────
if (!process.env.DATABASE_URL) {
    log.error('DATABASE_URL haipo — Bot imesimama.');
    process.exit(1);
}
if (!PHONE_NUMBER) {
    log.error('PHONE_NUMBER haipo — Bot imesimama.');
    process.exit(1);
}
if (!/^\d{10,15}$/.test(PHONE_NUMBER)) {
    log.error('PHONE_NUMBER si sahihi (mfano: 255753595142)');
    process.exit(1);
}

// ─── Bot state ───────────────────────────────────────
let sock           = null;
let isConnecting   = false;
let pairingRequested = false;
let bootLock       = false;
let openTimer      = null;

function clearOpenTimer() {
    if (openTimer) clearTimeout(openTimer);
    openTimer = null;
}

function displayPairingCode(code) {
    log.blank();
    console.log('  ┌────────────────────────────────────────────┐');
    console.log('  │              🔑  PAIRING CODE               │');
    console.log('  │                                            │');
    console.log(`  │         ${code.padEnd(36)}│`);
    console.log('  │                                            │');
    console.log('  └────────────────────────────────────────────┘');
    log.blank();
    log.info('WhatsApp → Linked Devices → Link a Device');
    log.info('Chagua "Link with phone number" → Weka nambari yako');
    log.blank();
}

// ─── Anzisha bot ─────────────────────────────────────
async function startBot() {
    if (bootLock || isConnecting) return;

    bootLock     = true;
    isConnecting = true;
    pairingRequested = false;
    clearOpenTimer();

    try {
        // Pata auth state kutoka PostgreSQL
        const { state, saveCreds } = await usePostgresAuthState(SESSION_ID);
        const { version } = await fetchLatestBaileysVersion();

        // Funga socket ya zamani
        if (sock) {
            try { sock.ev.removeAllListeners(); sock.ws?.close(); } catch {}
            sock = null;
        }

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys:  makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '120.0.0'],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection) log.state(`Connection  →  ${connection}`);

            // ── Omba pairing code (kwa session mpya tu) ──
            // HAPA NDIO LOGIC YA start.js: setTimeout 3s, pairingRequested, na connection !== 'close'
            if (!pairingRequested && !state.creds.registered && connection !== 'close') {
                setTimeout(async () => {
                    if (pairingRequested) return;
                    try {
                        pairingRequested = true;
                        log.info(`Inaomba pairing code kwa: ${PHONE_NUMBER}`);
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        displayPairingCode(code);
                    } catch (err) {
                        log.error(`Pairing code imeshindwa: ${err.message}`);
                        pairingRequested = false;
                    }
                }, 3000); // ← sekunde 3 kama start.js
            }

            // ── Imefunguka ──
            if (connection === 'open') {
                clearOpenTimer();
                log.div();
                log.success('BOT IMEUNGANIKA ✔');
                log.success('Session imehifadhiwa kwenye PostgreSQL (Railway)');
                log.div();
                isConnecting = false;
                bootLock     = false;
            }

            // ── Imevunjika ──
            if (connection === 'close') {
                clearOpenTimer();
                const code = lastDisconnect?.error?.output?.statusCode;
                log.div();
                log.error(`Muunganiko Umevunjika  →  [${code ?? '?'}]`);

                isConnecting = false;
                bootLock     = false;

                if (code === DisconnectReason.loggedOut || code === 401) {
                    log.warn('Session invalid. Inafuta session kutoka DB...');
                    await deleteSession(SESSION_ID);
                    log.info('Itaanzisha upya baada ya sekunde 10...');
                    setTimeout(startBot, 10000);
                } else if (!code || code === 408 || code === 503) {
                    log.info('Hitilafu ya mtandao — Inajaribu tena baada ya sekunde 5...');
                    setTimeout(startBot, 5000);
                } else {
                    log.info(`Inajaribu tena baada ya sekunde 7... [${code}]`);
                    setTimeout(startBot, 7000);
                }
            }
        });

        // Timeout - dakika 3
        openTimer = setTimeout(() => {
            log.warn('Muda umekwisha (3 min) — Itaanzisha upya...');
            isConnecting = false;
            bootLock = false;
            try { sock?.ev?.removeAllListeners(); sock?.ws?.close(); } catch {}
            setTimeout(startBot, 7000);
        }, 180000);

        if (state.creds.registered) {
            log.success('Session ipo DB — Inaunganika bila pairing...');
        } else {
            log.info('Session mpya — Inasubiri pairing code...');
        }

    } catch (err) {
        log.error(`HITILAFU KUBWA → ${err.message}`);
        isConnecting = false;
        bootLock = false;
        setTimeout(startBot, 7000);
    }
}

// ─── ENTRY: Anzisha database kwanza, kisha bot ──────
(async () => {
    try {
        log.info(`Inaunganika na PostgreSQL...`);
        await initializeDatabase();
        log.blank();
        await startBot();
    } catch (err) {
        log.error(`DB imeshindwa: ${err.message}`);
        log.error('Angalia DATABASE_URL kwenye Railway Variables.');
        process.exit(1);
    }
})();