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
    initDB,
    usePostgresAuthState,
    clearSession,
} = require('./session-db');

const logger = pino({ level: 'silent' });

const SESSION_ID   = process.env.SESSION_ID || 'queen_anita_v5';
const PHONE_NUMBER = process.env.PHONE_NUMBER?.trim();

// ─────────────────────────────────────────────────
//   LOGGER
// ─────────────────────────────────────────────────
const log = {
    info:    (msg) => console.log(`  ✦  ${msg}`),
    success: (msg) => console.log(`  ✔  ${msg}`),
    warn:    (msg) => console.log(`  ⚠  ${msg}`),
    error:   (msg) => console.log(`  ✖  ${msg}`),
    state:   (msg) => console.log(`  ◈  ${msg}`),
    div:     ()    => console.log(`  ${'─'.repeat(46)}`),
    blank:   ()    => console.log(''),
};

// ─────────────────────────────────────────────────
//   BANNER
// ─────────────────────────────────────────────────
log.blank();
console.log('  ╔════════════════════════════════════════════╗');
console.log('  ║                                            ║');
console.log('  ║       QUEEN_ANITA-V5   ·   RUNTIME         ║');
console.log('  ║       WhatsApp Bot   ·   Baileys            ║');
console.log('  ║       Session  ·   PostgreSQL (Railway)     ║');
console.log('  ║                                            ║');
console.log('  ╚════════════════════════════════════════════╝');
log.blank();

// ─────────────────────────────────────────────────
//   VALIDATIONS
// ─────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
    log.error('DATABASE_URL haipo kwenye .env — Bot imesimama.');
    process.exit(1);
}

if (!PHONE_NUMBER) {
    log.error('PHONE_NUMBER haipo kwenye .env — Bot imesimama.');
    process.exit(1);
}

if (!/^\d{10,15}$/.test(PHONE_NUMBER)) {
    log.error('PHONE_NUMBER si sahihi — Angalia format (255617155222)');
    process.exit(1);
}

// ─────────────────────────────────────────────────
//   BOT STATE
// ─────────────────────────────────────────────────
let sock           = null;
let isConnecting   = false;
let pairingDone    = false;
let bootLock       = false;
let openTimer      = null;

function clearOpenTimer() {
    if (openTimer) clearTimeout(openTimer);
    openTimer = null;
}

function displayPairingCode(code) {
    log.blank();
    console.log('  ┌────────────────────────────────────────────┐');
    console.log('  │                                            │');
    console.log('  │   🔑  PAIRING CODE                         │');
    console.log('  │                                            │');
    console.log(`  │         ${code.padEnd(36)}│`);
    console.log('  │                                            │');
    console.log('  └────────────────────────────────────────────┘');
    log.blank();
    log.info('WhatsApp  →  Linked Devices  →  Link a Device');
    log.info('Chagua    →  Link with phone number');
    log.info('Ingiza nambari yako  →  Bonyeza Confirm');
    log.blank();
}

// ─────────────────────────────────────────────────
//   ANZISHA BOT
// ─────────────────────────────────────────────────
async function startBot() {
    if (bootLock || isConnecting) return;

    bootLock     = true;
    isConnecting = true;
    pairingDone  = false;
    clearOpenTimer();

    try {
        // ── Pata auth state kutoka PostgreSQL ──
        const { state, saveCreds } = await usePostgresAuthState(SESSION_ID);
        const { version }          = await fetchLatestBaileysVersion();

        // ── Funga socket ya zamani ──
        if (sock) {
            try { sock.ev.removeAllListeners(); sock.ws?.close(); } catch {}
            sock = null;
        }

        // ── Unda socket mpya ──
        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys:  makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,
            printQRInTerminal: false,
            browser:               ['Ubuntu', 'Chrome', '120.0.0'],
            connectTimeoutMs:      60_000,
            keepAliveIntervalMs:   25_000,
            retryRequestDelayMs:   2_000,
            maxMsgRetryCount:      5,
            syncFullHistory:       false,
        });

        // ── Hifadhi creds zikibadilika ──
        sock.ev.on('creds.update', saveCreds);

        // ── Sikiliza mabadiliko ya muunganiko ──
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection) log.state(`Connection  →  ${connection}`);

            // ── Omba pairing code (session mpya tu) ──
            if (connection === 'connecting' && !pairingDone && !state.creds.registered) {
                pairingDone = true;

                setTimeout(async () => {
                    try {
                        if (!sock || sock.ws?.readyState !== 1) {
                            log.warn('Socket haijaiva — Pairing itarudiwa...');
                            pairingDone = false;
                            return;
                        }
                        log.info('Inaomba pairing code...');
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        displayPairingCode(code);
                    } catch (err) {
                        log.error(`Pairing imeshindwa → ${err.message}`);
                        pairingDone = false;
                    }
                }, 5000);
            }

            // ── Imeunganika ──
            if (connection === 'open') {
                clearOpenTimer();
                log.div();
                log.success('BOT IMEUNGANIKA ✔');
                log.success('Session imehifadhiwa kwenye PostgreSQL (Railway)');
                log.div();
                isConnecting = false;
                bootLock     = false;
            }

            // ── Muunganiko umevunjika ──
            if (connection === 'close') {
                clearOpenTimer();

                const code    = lastDisconnect?.error?.output?.statusCode;
                const reason  = lastDisconnect?.error?.message || 'unknown';

                log.div();
                log.error(`Muunganiko Umevunjika  →  [${code ?? '?'}] ${reason}`);

                isConnecting = false;
                bootLock     = false;

                if (code === DisconnectReason.loggedOut) {
                    log.warn('Logout halisi — Inafuta session kutoka DB...');
                    await clearSession(SESSION_ID);
                    log.info('Itaanzisha upya baada ya sekunde 10...');
                    setTimeout(startBot, 10_000);

                } else if (code === 405) {
                    log.error('Nambari imezuiwa na WhatsApp — Subiri dakika 5.');
                    setTimeout(startBot, 5 * 60_000);

                } else if (!code || code === 408 || code === 503) {
                    log.info('Hitilafu ya mtandao — Inajaribu tena baada ya sekunde 5...');
                    setTimeout(startBot, 5_000);

                } else {
                    log.info(`Inajaribu tena baada ya sekunde 7... [${code}]`);
                    setTimeout(startBot, 7_000);
                }
            }
        });

        // ── Timeout — dakika 3 ──
        openTimer = setTimeout(() => {
            log.warn('Muda umekwisha (3 min) — Itaanzisha upya...');
            isConnecting = false;
            bootLock     = false;
            try { sock?.ev?.removeAllListeners(); sock?.ws?.close(); } catch {}
            setTimeout(startBot, 7_000);
        }, 180_000);

        // ── Log hali ya session ──
        if (state.creds.registered) {
            log.success('Session ipo DB — Inaunganika bila pairing...');
        } else {
            log.info('Session mpya — Inasubiri pairing code...');
        }

    } catch (err) {
        log.div();
        log.error(`HITILAFU KUBWA  →  ${err.message}`);
        log.div();
        isConnecting = false;
        bootLock     = false;
        setTimeout(startBot, 7_000);
    }
}

// ─────────────────────────────────────────────────
//   ENTRY POINT — DB kwanza, kisha bot
// ─────────────────────────────────────────────────
(async () => {
    try {
        log.info(`Inaunganika na PostgreSQL...`);
        await initDB();
        log.blank();
        await startBot();
    } catch (err) {
        log.error(`DB imeshindwa kuunganika: ${err.message}`);
        log.error('Angalia DATABASE_URL kwenye Railway Variables.');
        process.exit(1);
    }
})();
