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

let validationErrorCount = 0;
let isRestarting = false; // kuzuia migongano

console.log('==============================');
console.log('  QUEEN_ANITA-V5 STARTING  ');
console.log('==============================');

// ------------------------------------------------------------
// 1. Ikiwa kuna SESSION_JSON kwenye env, iandike kwenye faili
//    (sasa hatuibadilishi muundo – tutaruhusu bot iangalie kama ni halali)
// ------------------------------------------------------------
if (process.env.SESSION_JSON && !fs.existsSync(SESSION_FILE)) {
    try {
        const rawSession = JSON.parse(process.env.SESSION_JSON);
        fs.writeFileSync(SESSION_FILE, JSON.stringify(rawSession, null, 2));
        console.log('✓ Session imeandikwa kutoka SESSION_JSON env');
    } catch (err) {
        console.error('❌ Kosa la kusoma SESSION_JSON:', err.message);
    }
}

// ------------------------------------------------------------
// 2. Msimbo wa kuweka na kupata session (salama)
// ------------------------------------------------------------
let currentState = { creds: {}, keys: {} };

const loadAuthState = () => {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = fs.readFileSync(SESSION_FILE, 'utf-8');
            const saved = JSON.parse(data);
            currentState = {
                creds: saved.creds || saved,  // kama saved ni creds peke yake
                keys: saved.keys || {}
            };
            return currentState;
        }
    } catch (e) {
        console.error('❌ Kosa la kusoma session.json:', e.message);
    }
    return { creds: {}, keys: {} };
};

const saveAuthState = () => {
    try {
        fs.writeFileSync(SESSION_FILE, JSON.stringify(currentState, null, 2));
        console.log('💾 Auth state imehifadhiwa');
    } catch (e) {
        console.error('❌ Kosa la kuhifadhi session.json:', e.message);
    }
};

const deleteSessionAndReset = () => {
    console.log('🧹 Session batili inafutwa...');
    try {
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    } catch(e) {}
    currentState = { creds: {}, keys: {} };
    validationErrorCount = 0;
};

// ------------------------------------------------------------
// 3. Anzisha bot
// ------------------------------------------------------------
async function startBot() {
    if (isRestarting) return;
    isRestarting = true;

    try {
        let authState = loadAuthState();
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: authState.creds,
                keys: authState.keys,
                saveCreds: () => {
                    currentState = {
                        creds: sock.authState.creds,
                        keys: sock.authState.keys
                    };
                    saveAuthState();
                }
            },
            printQRInTerminal: false,
            browser: ['AnitaV5', 'Chrome', '110.0.0']
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`🟢 BOT ONLINE - ${sock.user?.id || 'unknown'}`);
                validationErrorCount = 0; // reset count after success
                isRestarting = false;
            }

            if (connection === 'close') {
                const error = lastDisconnect?.error;
                const statusCode = error?.output?.statusCode;
                console.log('🔴 CONNECTION CLOSED');

                // Kugundua kama kosa ni la validation (session batili)
                const isValidationError = error?.message?.includes('validation') ||
                                         error?.message?.includes('public') ||
                                         statusCode === 403;

                if (isValidationError) {
                    validationErrorCount++;
                    console.log(`⚠️ Validation error #${validationErrorCount}`);
                    if (validationErrorCount >= 3) {
                        console.log('❌ Session imetambuliwa kuwa batili. Inafutwa na kuanza upya...');
                        deleteSessionAndReset();
                        validationErrorCount = 0;
                        setTimeout(() => {
                            isRestarting = false;
                            startBot();
                        }, 1000);
                        return;
                    }
                }

                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log('🔄 Reconnecting in 5 sec...');
                    setTimeout(() => {
                        isRestarting = false;
                        startBot();
                    }, 5000);
                } else {
                    console.log('❌ Logged out. Futa session.json na uanze upya.');
                    deleteSessionAndReset();
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
                console.log('⚠️ Hakikisha PHONE_NUMBER iko sahihi kwenye .env');
            }
        } else if (!isRegistered) {
            console.log('⚠️ Hakuna session na hakuna PHONE_NUMBER. Weka SESSION_JSON au PHONE_NUMBER');
        } else {
            console.log('✅ Session tayari imesajiliwa. Hakuna pairing inayohitajika.');
        }

        console.log('[✓] Bot initializing...');
        isRestarting = false;

    } catch (err) {
        console.error('BOT ERROR:', err);
        setTimeout(() => {
            isRestarting = false;
            startBot();
        }, 5000);
    }
}

startBot();