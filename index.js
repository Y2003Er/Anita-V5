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

if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}

console.log('==============================');
console.log('  QUEEN_ANITA-V5 STARTING    ');
console.log('==============================');

if (!PHONE_NUMBER) {
    console.log('❌ PHONE_NUMBER haipo kwenye .env');
    process.exit(1);
}

if (!/^\d{10,15}$/.test(PHONE_NUMBER)) {
    console.log('❌ PHONE_NUMBER si sahihi');
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
    console.log('\n╔══════════════════════════╗');
    console.log('║   🔑 PAIRING CODE        ║');
    console.log('╠══════════════════════════╣');
    console.log(`║      ${code}      ║`);
    console.log('╚══════════════════════════╝');
    console.log(`\n📋 CODE: ${code}\n`);
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

            console.log('🔄 State:', connection);

            // ✅ ONLY ONCE SAFE PAIRING TRIGGER
            if (
                connection === 'connecting' &&
                !pairingRequested &&
                !state.creds.registered
            ) {
                pairingRequested = true;

                setTimeout(async () => {
                    try {
                        if (!sock || sock.ws?.readyState !== 1) {
                            console.log('⚠️ Socket not ready, retrying pairing...');
                            pairingRequested = false;
                            return;
                        }

                        console.log(`📱 Requesting pairing code...`);
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        displayPairingCode(code);

                    } catch (err) {
                        console.log('❌ Pairing error:', err.message);
                        pairingRequested = false;
                    }
                }, 8000);
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

                console.log('❌ DISCONNECTED:', statusCode);

                isConnecting = false;
                bootLock = false;

                // ❗ FIX: only clear session on real logout
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('🧹 Session cleared');
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                }

                setTimeout(startBot, 7000);
            }
        });

        // ⏰ SAFETY TIMEOUT
        openTimer = setTimeout(() => {
            console.log('⏰ Timeout restart...');
            isConnecting = false;
            bootLock = false;

            try {
                sock?.ev?.removeAllListeners();
                sock?.ws?.close();
            } catch {}

            setTimeout(startBot, 7000);
        }, 120000);

        if (state.creds.registered) {
            console.log('✅ Session exists, connecting...');
        } else {
            console.log('⏳ New session, waiting pairing...');
        }

    } catch (err) {
        console.log('BOT ERROR:', err.message);
        isConnecting = false;
        bootLock = false;
        setTimeout(startBot, 7000);
    }
}

startBot();