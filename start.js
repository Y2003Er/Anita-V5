'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const SESSION_FILE = path.join(process.cwd(), 'session.json');
const PHONE_NUMBER = process.env.PHONE_NUMBER;

console.log('==============================');
console.log('  QUEEN_ANITA-V5 STARTING  ');
console.log('==============================');

// ------------------------------------------------------------
// 1. Ikiwa SESSION_JSON ipo kwenye mazingira, iandike kwenye faili
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
// 2. Unda 'auth state' yetu wenyewe kwa kutumia faili moja la JSON
// ------------------------------------------------------------
const loadAuthState = () => {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = fs.readFileSync(SESSION_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('❌ Kosa la kusoma session.json:', e.message);
    }
    return {};  // rudisha tupu ikiwa faili halipo
};

const saveAuthState = (state) => {
    try {
        fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
        console.log('💾 Auth state imehifadhiwa');
    } catch (e) {
        console.error('❌ Kosa la kuhifadhi session.json:', e.message);
    }
};

// ------------------------------------------------------------
// 3. Anzisha bot
// ------------------------------------------------------------
async function startBot() {
    try {
        let authState = loadAuthState();
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: authState.creds || {},
                keys: authState.keys || {},
                saveCreds: () => {
                    authState = {
                        creds: sock.authState.creds,
                        keys: sock.authState.keys
                    };
                    saveAuthState(authState);
                }
            },
            printQRInTerminal: false,
            browser: ['AnitaV5', 'Chrome', '110.0.0']
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`🟢 BOT ONLINE - ${sock.user?.id || 'unknown'}`);
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log('🔴 CONNECTION CLOSED');

                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log('🔄 Reconnecting in 5 sec...');
                    setTimeout(startBot, 5000);
                } else {
                    console.log('❌ Logged out. Futa session.json na uanze upya.');
                }
            }
        });

        // --------------------------------------------------------
        // 4. Omba pairing code TU ikiwa hakuna creds zilizosajiliwa
        // --------------------------------------------------------
        const isRegistered = authState.creds && authState.creds.registered === true;
        if (!isRegistered && PHONE_NUMBER) {
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log('🔑 PAIRING CODE:', code);
                console.log('💡 Ingiza code kwenye WhatsApp > Linked Devices');
            } catch (e) {
                console.log('❌ Pairing error:', e.message);
            }
        } else if (!isRegistered) {
            console.log('⚠️ Hakuna session na hakuna PHONE_NUMBER. Tafadhali weka SESSION_JSON au PHONE_NUMBER kwenye .env');
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