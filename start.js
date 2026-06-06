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

// Logger ya Baileys (tumia 'silent' usipohitaji kelele nyingi)
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

let sock = null;
let isConnecting = false;

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

    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR, logger);
        const { version } = await fetchLatestBaileysVersion();

        // Funga socket ya zamani ikiwa ipo (na ondoa listeners)
        if (sock) {
            sock.ev.removeAllListeners();
            sock.ws?.close();
            sock = null;
        }

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            browser: ['Ubuntu', 'Chrome', '120.0.0'],
        });

        // Hifadhi credentials zikibadilika
        sock.ev.on('creds.update', saveCreds);

        // ---- SEHEMU YA PAIRING (kama haijasajiliwa) ----
        if (!state.creds.registered) {
            console.log('⏳ Inasubiri connection imara...');

            // Subiri connection iingie angalau 'connecting' au 'open'
            await new Promise((resolve) => {
                const handler = (update) => {
                    const { connection } = update;
                    if (connection === 'connecting' || connection === 'open') {
                        sock.ev.off('connection.update', handler);
                        resolve();
                    }
                };
                sock.ev.on('connection.update', handler);
                // Fallback iwapo haitokei kabisa ndani ya sekunde 15
                setTimeout(() => {
                    sock.ev.off('connection.update', handler);
                    resolve();
                }, 15000);
            });

            // Hakikisha WebSocket iko OPEN (readyState === 1)
            if (sock.ws && sock.ws.readyState !== 1) {
                console.log('⏳ Inasubiri WebSocket kufunguka...');
                await new Promise((resolve) => {
                    const check = setInterval(() => {
                        if (sock.ws && sock.ws.readyState === 1) {
                            clearInterval(check);
                            resolve();
                        }
                    }, 500); // angalia kila nusu sekunde
                    // Timeout ya sekunde 10
                    setTimeout(() => {
                        clearInterval(check);
                        resolve();
                    }, 10000);
                });
            }

            console.log('⚡ Inaomba pairing code...');
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                displayPairingCode(code);
            } catch (e) {
                console.log('❌ Pairing error:', e.message);
                isConnecting = false;
                // Subiri sekunde 7 kabla ya kujaribu tena (ili kuepuka loop ya haraka)
                setTimeout(startBot, 7000);
                return;
            }
        } else {
            console.log('✅ Session ipo. Inaunganisha...');
        }

        // ---- SKIRIA ZA CONNECTION ----
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            console.log('🔄 State:', connection);

            if (connection === 'open') {
                console.log('🟢 BOT ONLINE SUCCESSFULLY!');
                isConnecting = false;
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                console.log('\n════ DISCONNECT INFO ════');
                console.log('Code:', statusCode);
                console.log(JSON.stringify(lastDisconnect, null, 2));
                console.log('════════════════════════\n');

                isConnecting = false;

                // Ikiwa ume-logged out au session imeharibika, futa na uanze upya
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('❌ Session invalid. Inafuta folder ya session...');
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                }

                // Subiri kidogo kisha anza upya
                setTimeout(startBot, 7000);
            }
        });

    } catch (err) {
        console.error('BOT ERROR:', err);
        isConnecting = false;
        setTimeout(startBot, 7000);
    }
}

startBot();