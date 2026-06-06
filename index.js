'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const pino = require('pino');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const logger = pino({ level: 'silent' });

const SESSION_DIR = path.resolve(process.env.SESSION_DIR || './session');
const PHONE_NUMBER = process.env.PHONE_NUMBER?.trim();

// ─────────────────────────────────────────────────
//   LOGGER UTILITY
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

if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// ─────────────────────────────────────────────────
//   BOOT BANNER
// ─────────────────────────────────────────────────
log.blank();
console.log('  ╔════════════════════════════════════════════╗');
console.log('  ║                                            ║');
console.log('  ║       QUEEN_ANITA-V5   ·   RUNTIME         ║');
console.log('  ║       WhatsApp Bot   ·   Baileys            ║');
console.log('  ║                                            ║');
console.log('  ╚════════════════════════════════════════════╝');
log.blank();

if (!PHONE_NUMBER) {
    log.error('PHONE_NUMBER haipo kwenye .env — Bot imesimama.');
    process.exit(1);
}

if (!/^\d{10,15}$/.test(PHONE_NUMBER)) {
    log.error('PHONE_NUMBER si sahihi — Angalia format (255...)');
    process.exit(1);
}

let sock = null;
let isConnecting = false;
let pairingRequested = false;
let bootLock = false;
let openTimer = null;

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
    log.info(`Pair Code      →  ${code}`);
    log.blank();
    log.info('WhatsApp  →  Linked Devices  →  Link a Device');
    log.info('Chagua    →  Link with phone number');
    log.info('Ingiza nambari yako  →  Bonyeza Confirm');
    log.blank();
}

async function startBot() {
    if (bootLock || isConnecting) return;

    bootLock = true;
    isConnecting = true;
    pairingRequested = false;
    clearOpenTimer();

    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
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
            auth: state,
            logger,
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '120.0.0'],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            log.state(`Connection  →  ${connection}`);

            if (
                connection === 'connecting' &&
                !pairingRequested &&
                !state.creds.registered
            ) {
                pairingRequested = true;

                setTimeout(async () => {
                    try {
                        if (!sock || sock.ws?.readyState !== 1) {
                            log.warn('Socket haijaiva — Pairing itarudiwa hivi karibuni...');
                            pairingRequested = false;
                            return;
                        }

                        log.info('Inaomba pairing code kwa nambari iliyowekwa...');
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        displayPairingCode(code);

                    } catch (err) {
                        log.error(`Pairing imeshindwa  →  ${err.message}`);
                        pairingRequested = false;
                    }
                }, 8000);
            }

            if (connection === 'open') {
                clearOpenTimer();
                log.div();
                log.success('BOT IMEUNGANIKA — INAENDESHA VIZURI');
                log.div();
                isConnecting = false;
                bootLock = false;
            }

            if (connection === 'close') {
                clearOpenTimer();

                const statusCode = lastDisconnect?.error?.output?.statusCode;

                log.div();
                log.error(`Muunganiko Umevunjika  →  Status ${statusCode ?? 'unknown'}`);

                isConnecting = false;
                bootLock = false;

                if (statusCode === DisconnectReason.loggedOut) {
                    log.warn('Session imefutwa — Itaanzisha upya...');
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                }

                log.info('Inajaribu kuunganika tena baada ya sekunde 7...');
                log.div();
                setTimeout(startBot, 7000);
            }
        });

        openTimer = setTimeout(() => {
            log.warn('Muda umekwisha — Bot itaanzisha upya...');
            isConnecting = false;
            bootLock = false;

            try {
                sock?.ev?.removeAllListeners();
                sock?.ws?.close();
            } catch {}

            setTimeout(startBot, 7000);
        }, 120000);

        if (state.creds.registered) {
            log.success('Session inapatikana — Inaunganika...');
        } else {
            log.info('Session mpya — Inasubiri pairing code...');
        }

    } catch (err) {
        log.div();
        log.error(`HITILAFU KUBWA  →  ${err.message}`);
        log.div();
        isConnecting = false;
        bootLock = false;
        setTimeout(startBot, 7000);
    }
}

startBot();
