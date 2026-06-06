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
const INVALID_FLAG_FILE = path.join(process.cwd(), '.session_invalid');
const PHONE_NUMBER = process.env.PHONE_NUMBER;

let validationErrorCount = 0;
let isRestarting = false;
let ignoreEnvSession = false;

console.log('==============================');
console.log('  QUEEN_ANITA-V5 STARTING  ');
console.log('==============================');

// ------------------------------------------------------------
// 1. Angalia ikiwa session imetambuliwa kuwa batili hapo awali
// ------------------------------------------------------------
if (fs.existsSync(INVALID_FLAG_FILE)) {
    ignoreEnvSession = true;
    console.log('⚠️ Alama ya session batili ipo. SESSION_JSON itapuuzwa.');
}

// ------------------------------------------------------------
// 2. Soma SESSION_JSON kwa sharti tu kama haijapuuzwa
// ------------------------------------------------------------
if (!ignoreEnvSession && process.env.SESSION_JSON && !fs.existsSync(SESSION_FILE)) {
    try {
        const rawSession = JSON.parse(process.env.SESSION_JSON);
        fs.writeFileSync(SESSION_FILE, JSON.stringify(rawSession, null, 2));
        console.log('✓ Session imeandikwa kutoka SESSION_JSON env');
    } catch (err) {
        console.error('❌ Kosa la kusoma SESSION_JSON:', err.message);
    }
}

// ------------------------------------------------------------
// 3. Kazi za kusimamia auth state
// ------------------------------------------------------------
let currentState = { creds: {}, keys: {} };

const loadAuthState = () => {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            const data = fs.readFileSync(SESSION_FILE, 'utf-8');
            const saved = JSON.parse(data);
            currentState = {
                creds: saved.creds || saved,
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

const deleteSessionAndMarkInvalid = () => {
    console.log('🧹 Session batili inafutwa na kuwekewa alama...');
    try {
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
        fs.writeFileSync(INVALID_FLAG_FILE, Date.now().toString());
    } catch(e) {}
    currentState = { creds: {}, keys: {} };
    validationErrorCount = 0;
    ignoreEnvSession = true;
};

// ------------------------------------------------------------
// 4. Anzisha bot (tumeanza salama)
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
                    // Ikiwa session imehifadhiwa kwa mafanikio, ondoa alama ya batili
                    if (fs.existsSync(INVALID_FLAG_FILE)) {
                        fs.unlinkSync(INVALID_FLAG_FILE);
                        console.log('✅ Alama ya session batili imeondolewa.');
                    }
                }
            },
            printQRInTerminal: false,
            browser: ['AnitaV5', 'Chrome', '110.0.0']
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`🟢 BOT ONLINE - ${sock.user?.id || 'unknown'}`);
                validationErrorCount = 0;
                isRestarting = false;
            }

            if (connection === 'close') {
                const error = lastDisconnect?.error;
                const statusCode = error?.output?.statusCode;
                console.log('🔴 CONNECTION CLOSED');

                const isValidationError = error?.message?.includes('validation') ||
                                         error?.message?.includes('public') ||
                                         statusCode === 403;

                if (isValidationError) {
                    validationErrorCount++;
                    console.log(`⚠️ Validation error #${validationErrorCount}`);
                    if (validationErrorCount >= 3) {
                        console.log('❌ Session imetambuliwa kuwa batili. Inafutwa...');
                        deleteSessionAndMarkInvalid();
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
                    deleteSessionAndMarkInvalid();
                }
            }
        });

        // --------------------------------------------------------
        // 5. Omba pairing code tu ikiwa hakuna creds zilizosajiliwa
        //    Subiri kidogo ili socket iwe tayari kikamilifu
        // --------------------------------------------------------
        const isRegistered = authState.creds && authState.creds.registered === true;
        if (!isRegistered && PHONE_NUMBER) {
            // Subiri sekunde 2 ili socket iwe stable
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log('🔑 PAIRING CODE:', code);
                console.log('💡 Ingiza code kwenye WhatsApp > Linked Devices');
            } catch (e) {
                console.log('❌ Pairing error:', e.message);
                if (e.message.includes('public')) {
                    console.log('⚠️ Tatizo la muundo. Hakikisha PHONE_NUMBER iko sahihi (bila + au nafasi).');
                }
            }
        } else if (!isRegistered) {
            console.log('⚠️ Hakuna session na hakuna PHONE_NUMBER. Weka PHONE_NUMBER kwenye .env');
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