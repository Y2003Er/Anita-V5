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
const https = require('https');

// Logger itakayosaidia kuona kila hatua (aacha 'info' wakati unatest)
const logger = pino({ level: 'info' });

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

// Hakikisha namba inaanza na nchi bila '+', mfano 2557...
if (!/^\d{10,15}$/.test(PHONE_NUMBER)) {
    console.log('❌ PHONE_NUMBER si sahihi. Tumia namba pekee, mfano 255712345678');
    process.exit(1);
}

let sock = null;
let isConnecting = false;
let pairingRequested = false;
let bootLock = false;
let openTimer = null;

// SSL Agent ya kupuuza uthibitisho (kwa testing TU, ondoa kwenye production)
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

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
    console.log(`\n📋 CODE: ${code}\n');
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
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR, logger);
        const { version } = await fetchLatestBaileysVersion();

        // Funga ya zamani
        if (sock) {
            try {
                sock.ev.removeAllListeners();
                sock.ws?.close();
            } catch {}
            sock = null;
        }

        // ---------- SOCKET CONFIG ----------
        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            logger,                       // itaonyesha debug kwenye terminal
            printQRInTerminal: false,
            // Browser inayokubalika na WhatsApp (Chrome on Linux)
            browser: ['Chrome (Linux)', '', ''],
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            agent: insecureAgent,         // remove after fixing SSL
        });

        sock.ev.on('creds.update', saveCreds);

        // ---------- MAIN LISTENER ----------
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            console.log('🔄 State:', connection);

            if (connection === 'open') {
                clearOpenTimer();
                console.log('🟢 BOT ONLINE SUCCESSFULLY!');
                isConnecting = false;
                bootLock = false;

                if (!state.creds.registered && !pairingRequested) {
                    pairingRequested = true;
                    console.log('⚡ Inaomba pairing code...');
                    try {
                        // Subiri WebSocket iwe tayari
                        if (sock.ws?.readyState !== 1) {
                            await new Promise(resolve => {
                                const check = setInterval(() => {
                                    if (sock.ws?.readyState === 1) {
                                        clearInterval(check);
                                        resolve();
                                    }
                                }, 500);
                                setTimeout(() => {
                                    clearInterval(check);
                                    resolve();
                                }, 5000);
                            });
                        }
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        displayPairingCode(code);
                    } catch (e) {
                        console.log('❌ Pairing error:', e.message);
                        isConnecting = false;
                        bootLock = false;
                        setTimeout(startBot, 7000);
                        return;
                    }
                }
            }

            if (connection === 'close') {
                clearOpenTimer();
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log('\n════ DISCONNECT INFO ════');
                console.log('Code:', statusCode);
                console.log(JSON.stringify(lastDisconnect, null, 2));
                console.log('════════════════════════\n');

                isConnecting = false;
                bootLock = false;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('❌ Session invalid. Inafuta...');
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                }

                setTimeout(startBot, 7000);
            }
        });

        // Timer ya dharura (kama haifunguki)
        openTimer = setTimeout(() => {
            console.log('⏰ Haikufunguka kwa sekunde 90. Restarting...');
            isConnecting = false;
            bootLock = false;
            if (sock) {
                try { sock.ev.removeAllListeners(); sock.ws?.close(); } catch {}
            }
            setTimeout(startBot, 7000);
        }, 90000);

        if (state.creds.registered) {
            console.log('✅ Session ipo. Inaunganisha...');
        } else {
            console.log('⏳ Inasubiri muunganisho wa kwanza (max 90s)...');
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