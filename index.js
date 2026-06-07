'use strict';

const dotenv = require('dotenv');
dotenv.config();

const pino = require('pino');
const NodeCache = require('node-cache');
const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,       // <-- ADDED
} = require('@whiskeysockets/baileys');

// Keep only initializeDatabase from session-db (for AI memory table)
const { initializeDatabase } = require('./session-db');

// Load config (global variables kama prefix, owner, n.k.)
require('./config');

// Load command handler
const { loadCommands, handleMessage, setupContactListener } = require('./lib/handler');

const logger = pino({ level: 'info' });

const SESSION_ID   = process.env.SESSION_ID || 'queen_anita_v5';  // not used for file auth, but keep
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
console.log('  ║       Session  ·   File System (./sessions)║');  // Updated banner
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
let sock = null;
let isConnecting = false;
let pairingRequested = false;
let bootLock = false;
let openTimer = null;

function clearOpenTimer() {
    if (openTimer) clearTimeout(openTimer);
    openTimer = null;
}

// ========== PAIRING LOGIC ==========
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

// ─── Anzisha bot ─────────────────────────────────────
async function startBot() {
    if (bootLock || isConnecting) return;
    if (sock?.ws?.readyState === 1) return;

    bootLock = true;
    isConnecting = true;
    pairingRequested = false;
    clearOpenTimer();

    try {
        loadCommands();
        log.success('Commands zimepakiwa.');

        // ✅ USE FILE-BASED AUTH (works 100% with v7)
        const { state, saveCreds } = await useMultiFileAuthState('./sessions');

        // v7 requires msgRetryCounterCache
        const msgRetryCounterCache = new NodeCache();

        // Properly destroy old socket with a delay
        if (sock) {
            try {
                sock.ev.removeAllListeners();
                await sock.ws?.close();
                sock.end?.(new Error('Restarting'));
            } catch (e) {}
            sock = null;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            msgRetryCounterCache,
            logger,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 120000,
            keepAliveIntervalMs: 30000,
            defaultQueryTimeoutMs: undefined,
            generateHighQualityLinkPreview: false,
            patchMessageBeforeSending: (msg) => msg,
        });

        sock.ev.on('creds.update', saveCreds);

        setupContactListener(sock);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection) log.state(`Connection  →  ${connection}`);

            // Request pairing code only if new session (no creds.registered)
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
                log.div();
                log.success('BOT IMEUNGANIKA ✔');
                log.success('Session imehifadhiwa kwenye folder ./sessions');
                log.div();
                isConnecting = false;
                bootLock = false;
            }

            if (connection === 'close') {
                clearOpenTimer();
                const code = lastDisconnect?.error?.output?.statusCode;
                log.div();
                log.error(`Muunganiko Umevunjika → [${code ?? '?'}]`);

                isConnecting = false;
                bootLock = false;

                if (code === 440) {
                    log.warn('Connection replaced (440) – waiting 15s before restart');
                    setTimeout(startBot, 15000);
                } else if (code === DisconnectReason.loggedOut || code === 401) {
                    log.warn('Session invalid. Inafuta session...');
                    // Optionally delete the session folder
                    const fs = require('fs');
                    if (fs.existsSync('./sessions')) fs.rmSync('./sessions', { recursive: true, force: true });
                    setTimeout(startBot, 10000);
                } else {
                    log.warn('Unknown disconnect – restarting in 7s');
                    setTimeout(startBot, 7000);
                }
            }
        });

        // messages.upsert – unchanged
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message) return;
            if (msg.key.fromMe) return;

            const text = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text ||
                         '[non-text message]';
            console.log(`📩 Ujumbe kutoka ${msg.key.remoteJid}: ${text}`);

            await handleMessage(sock, msg);
        });

        openTimer = setTimeout(() => {
            log.warn('Timeout — restart...');
            isConnecting = false;
            bootLock = false;
            try {
                sock?.ev?.removeAllListeners();
                sock?.ws?.close();
            } catch {}
            setTimeout(startBot, 7000);
        }, 180000);

        if (state.creds.registered) {
            log.success('Session ipo file system — Inaunganika...');
        } else {
            log.info('Session mpya — inasubiri pairing...');
        }

    } catch (err) {
        log.error(`HITILAFU → ${err.message}`);
        isConnecting = false;
        bootLock = false;
        setTimeout(startBot, 7000);
    }
}

// ─── ENTRY POINT ─────────────────────────────────────
(async () => {
    try {
        log.info('Inaunganika na PostgreSQL (kwa ajili ya AI memory tu)...');
        await initializeDatabase();  // still creates ai_memory table if needed
        log.blank();
        await startBot();
    } catch (err) {
        log.error(`DB error: ${err.message}`);
        process.exit(1);
    }
})();