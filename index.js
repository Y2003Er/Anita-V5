'use strict';
require('dotenv').config();
const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { usePostgreSQLAuthState } = require('@whiskeysockets/baileys');
const { Pool } = require('pg');

const PHONE_NUMBER = process.env.PHONE_NUMBER?.trim();
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL haipo! Hakikisha Postgres imeunganishwa.');
    process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

console.log('==============================');
console.log('  QUEEN_ANITA-V5 STARTING  ');
console.log('==============================');

let sock;
let isPairing = false;

async function startBot() {
    try {
        // Tumia PostgreSQL kuhifadhi session (inadumu milele)
        const { state, saveCreds } = await usePostgreSQLAuthState(pool, 'anita_session');

        sock = makeWASocket({
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
                console.log(`🟢 BOT ONLINE - ${sock.user?.id || 'unknown'}`);
                isPairing = false;
            }

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                console.log(`🔴 CONNECTION CLOSED (${code})`);
                if (code !== DisconnectReason.loggedOut) {
                    setTimeout(startBot, 5000);
                } else {
                    console.log('❌ Logged out. Futa database entry na uanze upya.');
                }
            }
        });

        // Omba pairing code ikiwa session haijasajiliwa
        if (!state.creds.registered && !isPairing && PHONE_NUMBER) {
            isPairing = true;
            console.log('⏳ Inaomba pairing code...');
            await new Promise(r => setTimeout(r, 2000));
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log(`🔑 PAIRING CODE: ${code}`);
                console.log('💡 Ingiza code kwenye WhatsApp > Linked Devices');
            } catch (err) {
                console.error('❌ Pairing error:', err.message);
            }
        } else if (!state.creds.registered) {
            console.log('❌ Hakuna PHONE_NUMBER kwenye .env');
            process.exit(1);
        } else {
            console.log('✅ Session ipo kwenye database. Hakuna pairing.');
        }

        console.log('[✓] Bot initializing...');
    } catch (err) {
        console.error('BOT ERROR:', err);
        setTimeout(startBot, 5000);
    }
}

startBot();