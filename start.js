'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

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

let sock = null;
let isConnecting = false;
let pairingRequested = false; // 🔥 FIX 1: prevent duplicate pairing

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
    if (isConnecting) return;
    isConnecting = true;
    pairingRequested = false; // 🔥 reset kila start

    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        const { version } = await fetchLatestBaileysVersion();

        // Funga socket ya zamani
        if (sock) {
            try {
                sock.ev.removeAllListeners();
                sock.ws?.close();
            } catch {}
        }

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, console)
            },
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '120.0.0']
        });

        sock.ev.on('creds.update', saveCreds);

        // =========================
        // 🔥 PAIRING (FIXED ONCE ONLY)
        // =========================
        if (!state.creds.registered && !pairingRequested) {
            pairingRequested = true;

            console.log('⚡ Inaomba pairing code...');

            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                displayPairingCode(code);
            } catch (e) {
                console.log('❌ Pairing error:', e.message);
                isConnecting = false;
                setTimeout(startBot, 5000);
                return;
            }
        } else if (state.creds.registered) {
            console.log('✅ Session ipo. Inaunganisha...');
        }

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;

            console.log('🔄 State:', connection || 'unknown');

            if (connection === 'open') {
                console.log('🟢 BOT ONLINE SUCCESSFULLY!');
                isConnecting = false;
                pairingRequested = false; // 🔥 reset after success
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                console.log('\n════ DISCONNECT INFO ════');
                console.log('Code:', statusCode);
                console.log(JSON.stringify(lastDisconnect, null, 2));
                console.log('════════════════════════\n');

                isConnecting = false;
                pairingRequested = false;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('❌ Session invalid. Inafuta...');
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                }

                setTimeout(startBot, 5000);
            }
        });

    } catch (err) {
        console.error('BOT ERROR:', err);
        isConnecting = false;
        pairingRequested = false;
        setTimeout(startBot, 5000);
    }
}

startBot();