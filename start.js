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
console.log('  26 TECH SOLUTION STARTING  ');
console.log('==============================');

if (!PHONE_NUMBER) {
    console.log('❌ PHONE_NUMBER haipo kwenye .env');
    process.exit(1);
}

if (!/^\d{10,15}$/.test(PHONE_NUMBER)) {
    console.log('❌ PHONE_NUMBER si sahihi. Tumia namba pekee, mfano 255712345678');
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
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR, logger);
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
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
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
            console.log('✅ Session ipo. Inaunganisha...');
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
