'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');

const SESSION_DIR = process.env.SESSION_DIR || path.join(process.cwd(), 'session');
const PHONE_NUMBER = process.env.PHONE_NUMBER; // mfano: 2557xxxxxxx

console.log('==============================');
console.log('  QUEEN_ANITA-V5 STARTING  ');
console.log('==============================');

async function startBot() {
    try {

        if (!fs.existsSync(SESSION_DIR)) {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // ❌ important: disable QR
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, pairingCode } = update;

            if (connection === 'open') {
                console.log('🟢 BOT ONLINE');
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;

                console.log('🔴 CONNECTION CLOSED');

                if (reason !== DisconnectReason.loggedOut) {
                    setTimeout(startBot, 5000);
                }
            }

            // ✅ PAIRING CODE FLOW
            if (!sock.authState.creds.registered) {
                if (PHONE_NUMBER) {
                    try {
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        console.log('🔑 PAIRING CODE:', code);
                    } catch (e) {
                        console.log('Pairing error:', e.message);
                    }
                } else {
                    console.log('❌ Set PHONE_NUMBER in .env');
                }
            }
        });

        console.log('[✓] Bot initializing...');

    } catch (err) {
        console.error('BOT ERROR:', err);
        setTimeout(startBot, 5000);
    }
}

startBot();