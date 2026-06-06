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

let sock = null;
let isConnecting = false;
let pairingRequested = false; // kuzuia pairing code kuombwa mara mbili

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
    pairingRequested = false; // reset kwa kila jaribio jipya

    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR, logger);
        const { version } = await fetchLatestBaileysVersion();

        // Funga socket ya zamani ikiwa ipo
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

        // Weka listener ya kudumu mara moja — hii inabaki kila wakati
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            console.log('🔄 State:', connection);

            if (connection === 'open') {
                console.log('🟢 BOT ONLINE SUCCESSFULLY!');
                isConnecting = false;

                // Ikiwa bado haijasajiliwa, omba pairing code
                if (!state.creds.registered && !pairingRequested) {
                    pairingRequested = true;
                    console.log('⚡ Inaomba pairing code...');
                    try {
                        // Hakikisha WebSocket iko OPEN
                        if (sock.ws?.readyState === 1) {
                            const code = await sock.requestPairingCode(PHONE_NUMBER);
                            displayPairingCode(code);
                        } else {
                            // Subiri kidogo hadi iwe tayari
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
                            const code = await sock.requestPairingCode(PHONE_NUMBER);
                            displayPairingCode(code);
                        }
                    } catch (e) {
                        console.log('❌ Pairing error:', e.message);
                        // Jaribu tena baada ya sekunde 7
                        isConnecting = false;
                        setTimeout(startBot, 7000);
                        return;
                    }
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log('\n════ DISCONNECT INFO ════');
                console.log('Code:', statusCode);
                console.log(JSON.stringify(lastDisconnect, null, 2));
                console.log('════════════════════════\n');

                isConnecting = false;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log('❌ Session invalid. Inafuta folder ya session...');
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                }

                // Anza upya baada ya sekunde 7
                setTimeout(startBot, 7000);
            }
        });

        // Kama tayari imesajiliwa, hakuna cha ziada — listener itashughulikia
        if (state.creds.registered) {
            console.log('✅ Session ipo. Inaunganisha...');
        } else {
            console.log('⏳ Inasubiri muunganisho wa kwanza... (usingoje pairing code)');
        }

    } catch (err) {
        console.error('BOT ERROR:', err);
        isConnecting = false;
        setTimeout(startBot, 7000);
    }
}

startBot();