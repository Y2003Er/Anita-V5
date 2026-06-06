'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    PHONENUMBER_MCC
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

const mcc = PHONENUMBER_MCC?.['255'];
if (!mcc) {
    console.log('⚠️ Tanzania MCC haipatikani - itaendelea bila MCC check');
}

let isReconnecting = false;
let pairingDone = false;
let pairingTimer = null;
let currentSock = null;

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
    console.log('⚠️  WhatsApp itatoa POPUP yenyewe!');
    console.log('👆 Settings → Linked Devices → Link a Device');
    console.log('👆 Link with phone number → Weka namba');
    console.log('👆 Bonyeza CONFIRM kwenye popup\n');
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
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📱 WA version: ${version.join('.')} latest: ${isLatest}`);

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, console)
            },
            printQRInTerminal: false,
            mobile: false,
            browser: ['Chrome (Ubuntu)', 'Chrome', '121.0.0.0'],
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 120000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 2000,
            maxMsgRetryCount: 5,
        });

        currentSock = sock;
        sock.ev.on('creds.update', saveCreds);

        let pairingRequested = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            console.log(`🔄 Connection state: ${connection || 'unknown'}`);

            if (connection === 'connecting' && !pairingRequested && !pairingDone && !state.creds.registered) {
                pairingRequested = true;
                console.log('⚡ Inaomba pairing code mara moja...');

                await new Promise(r => setTimeout(r, 1500));

                try {
                    const code = await sock.requestPairingCode(PHONE_NUMBER);
                    pairingDone = true;
                    displayPairingCode(code);

                    pairingTimer = setTimeout(() => {
                        console.log('⏰ Dakika 2 zimepita. Code mpya...');
                        pairingDone = false;
                        pairingRequested = false;
                        sock.end();
                        isReconnecting = false;
                        setTimeout(startBot, 3000);
                    }, 120000);

                } catch (err) {
                    console.error('❌ Pairing imeshindwa:', err.message);
                    pairingDone = false;
                    pairingRequested = false;
                    isReconnecting = false;
                }
            }

            if (connection === 'open') {
                console.log(`🟢 BOT ONLINE - ${sock.user?.id}`);
                isReconnecting = false;
                pairingDone = false;
                pairingRequested = false;
                if (pairingTimer) {
                    clearTimeout(pairingTimer);
                    pairingTimer = null;
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const reason = lastDisconnect?.error?.message;

                isReconnecting = false;

                console.log('\n══════ DISCONNECT INFO ══════');
                console.log('Status Code:', statusCode);
                console.log('Reason:', reason);
                console.log(JSON.stringify(lastDisconnect, null, 2));
                console.log('══════════════════════════════\n');

                // ✅ STOP LOOP ikiwa bado pairing inaendelea
                if (!state.creds.registered) {
                    console.log('⌛ Still pairing... no restart loop');
                    return;
                }

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('❌ Logged out - clearing session');
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    fs.mkdirSync(SESSION_DIR, { recursive: true });
                    setTimeout(startBot, 3000);
                    return;
                }

                console.log('🔄 Reconnecting...');
                setTimeout(startBot, 5000);
            }
        });

        if (state.creds.registered) {
            console.log('✅ Session ipo. Inaunganisha...');
        }

    } catch (err) {
        console.error('BOT ERROR:', err);
        isReconnecting = false;
        setTimeout(startBot, 5000);
    }
}

startBot();