'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    useMultiFileAuthState
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
let pairingDone = false; // ✅ Zuia pairing kurudiwa

async function startBot() {
    if (isReconnecting) return;
    isReconnecting = true;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.windows('Chrome'),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`🟢 BOT ONLINE - ${sock.user?.id}`);
                isReconnecting = false;
                pairingDone = false;
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                isReconnecting = false;

                // ✅ Kama pairing imefanywa, subiri mtumiaji aweke code
                // Usireconnect haraka haraka
                if (pairingDone) {
                    console.log('⏳ Pairing code imetolewa. Inasubiri mtumiaji...');
                    console.log('🔄 Reconnecting baada ya sekunde 30...');
                    setTimeout(startBot, 30000); // ✅ Sekunde 30 badala ya 5
                    return;
                }

                console.log(`🔴 CONNECTION CLOSED (${code})`);

                if (code === DisconnectReason.loggedOut) {
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
            // Subiri connection iwe connecting kwanza
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
                pairingDone = true; // ✅ Weka alama pairing imefanywa

                // ✅ Onyesha code kwa njia inayoonekana wazi
                console.log('\n');
                console.log('╔══════════════════════════════╗');
                console.log(`║  🔑 PAIRING CODE: ${code}  ║`);
                console.log('╚══════════════════════════════╝');
                console.log('👆 Nenda WhatsApp > Linked Devices > Link with phone number');
                console.log('⏳ Una dakika 2 kuweka code hii\n');

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