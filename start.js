'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const SESSION_DIR = path.resolve(process.env.SESSION_DIR || './session');
const PHONE_NUMBER = process.env.PHONE_NUMBER?.trim();

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

fs.readdirSync(SESSION_DIR).forEach(file => {
    if (!file.endsWith('.json')) {
        fs.unlinkSync(path.join(SESSION_DIR, file));
        console.log(`⚠️ Removed junk file: ${file}`);
    }
});

console.log('==============================');
console.log('  QUEEN_ANITA-V5 STARTING    ');
console.log('==============================');

if (!PHONE_NUMBER) {
    console.log('❌ PHONE_NUMBER haipo kwenye .env');
    process.exit(1);
}

let isReconnecting = false;
let pairingDone = false;
let pairingTimer = null;

function displayPairingCode(code) {
    console.log('\n');
    console.log('╔══════════════════════════════════╗');
    console.log('║        🔑 PAIRING CODE           ║');
    console.log('╠══════════════════════════════════╣');
    console.log(`║       >>  ${code}  <<       ║`);
    console.log('╠══════════════════════════════════╣');
    console.log('║  📋 NAKILI CODE HAPA JUU         ║');
    console.log('╚══════════════════════════════════╝');
    console.log('');
    console.log(`📋 CODE: ${code}`);
    console.log('');
    console.log('👆 WhatsApp → Settings → Linked Devices');
    console.log('👆 Link a Device → Link with phone number');
    console.log('👆 Weka namba → Bonyeza CONFIRM kwenye popup');
    console.log('⏳ Una dakika 2 kuweka code!\n');
}

async function startBot() {
    if (isReconnecting) return;
    isReconnecting = true;

    if (pairingTimer) {
        clearTimeout(pairingTimer);
        pairingTimer = null;
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        // ✅ Pata version mpya ya WhatsApp
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📱 WhatsApp version: ${version.join('.')} (latest: ${isLatest})`);

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            mobile: false,
            browser: ['Chrome (Ubuntu)', 'Chrome', '121.0.0.0'],
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 120000,
            keepAliveIntervalMs: 10000,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`🟢 BOT ONLINE - ${sock.user?.id}`);
                isReconnecting = false;
                pairingDone = false;
                if (pairingTimer) {
                    clearTimeout(pairingTimer);
                    pairingTimer = null;
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                isReconnecting = false;

                if (pairingDone) {
                    console.log('🔄 Inaendelea kusubiri mtumiaji...');
                    setTimeout(startBot, 3000);
                    return;
                }

                console.log(`🔴 CONNECTION CLOSED (${statusCode})`);

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('❌ Logged out. Inafuta session...');
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                    pairingDone = false;
                    setTimeout(startBot, 3000);
                } else {
                    console.log('🔄 Reconnecting baada ya sekunde 5...');
                    setTimeout(startBot, 5000);
                }
            }
        });

        if (!state.creds.registered && !pairingDone) {
            await new Promise(resolve => {
                const handler = (u) => {
                    if (u.connection === 'connecting' || u.connection === 'open') {
                        sock.ev.off('connection.update', handler);
                        resolve();
                    }
                };
                sock.ev.on('connection.update', handler);
                setTimeout(resolve, 8000);
            });

            await new Promise(r => setTimeout(r, 3000));

            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                pairingDone = true;
                displayPairingCode(code);

                pairingTimer = setTimeout(() => {
                    console.log('⏰ Dakika 2 zimepita. Inaomba code mpya...');
                    pairingDone = false;
                    sock.end();
                    isReconnecting = false;
                    setTimeout(startBot, 3000);
                }, 120000);

            } catch (err) {
                console.error('❌ Pairing imeshindwa:', err.message);
                pairingDone = false;
                sock.end();
                isReconnecting = false;
                setTimeout(startBot, 10000);
            }
        } else if (state.creds.registered) {
            console.log('✅ Session ipo. Inaunganisha...');
        }

    } catch (err) {
        console.error('BOT ERROR:', err);
        isReconnecting = false;
        setTimeout(startBot, 5000);
    }
}

startBot();