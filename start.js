'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const {
    default: makeWASocket,
    useSingleFileAuthState,   // ← muhimu: tumia faili moja la JSON
    DisconnectReason
} = require('@whiskeysockets/baileys');

const SESSION_FILE = path.join(process.cwd(), 'session.json');
const PHONE_NUMBER = process.env.PHONE_NUMBER; // inaweza kubaki kwenye .env

console.log('==============================');
console.log('  QUEEN_ANITA-V5 STARTING  ');
console.log('==============================');

// ------------------------------------------------------------
// 1. Ikiwa umeweka SESSION_JSON kwenye Railway environment,
//    andika kwenye session.json kabla ya kuanza bot
// ------------------------------------------------------------
if (process.env.SESSION_JSON) {
    try {
        const sessionData = JSON.parse(process.env.SESSION_JSON);
        fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
        console.log('✓ Session imeandikwa kutoka SESSION_JSON env');
    } catch (err) {
        console.error('❌ Kosa la kusoma SESSION_JSON:', err.message);
    }
}

// ------------------------------------------------------------
// 2. Anzisha bot kwa kutumia session.json (au iunda tupu)
// ------------------------------------------------------------
async function startBot() {
    try {
        const { state, saveCreds } = useSingleFileAuthState(SESSION_FILE);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['AnitaV5', 'Chrome', '110.0.0']
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`🟢 BOT ONLINE - ${sock.user?.id || 'unknown'}`);
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.log('🔴 CONNECTION CLOSED');

                if (reason !== DisconnectReason.loggedOut) {
                    console.log('🔄 Reconnecting in 5 sec...');
                    setTimeout(startBot, 5000);
                } else {
                    console.log('❌ Imelogout, futa session.json na uanze upya.');
                }
            }
        });

        // --------------------------------------------------------
        // 3. HATUA MUHIMU: OMBA PAIRING CODE IKIWA TU HAJAS AJILIWA
        //    Ikiwa tayari registered, pairing hairudiwi.
        // --------------------------------------------------------
        if (!state.creds.registered) {
            if (PHONE_NUMBER) {
                try {
                    const code = await sock.requestPairingCode(PHONE_NUMBER);
                    console.log('🔑 PAIRING CODE:', code);
                    console.log('💡 Ingiza code kwenye WhatsApp linked devices.');
                } catch (e) {
                    console.log('❌ Pairing error:', e.message);
                }
            } else {
                console.log('⚠️ Hakuna PHONE_NUMBER. Tumia QR au angalia .env');
            }
        } else {
            console.log('✅ Session tayari imesajiliwa. Hakuna pairing inayohitajika.');
        }

        console.log('[✓] Bot initializing...');

    } catch (err) {
        console.error('BOT ERROR:', err);
        setTimeout(startBot, 5000);
    }
}

startBot();