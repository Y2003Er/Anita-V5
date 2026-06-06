'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');

const SESSION_FILE = path.join(process.cwd(), 'session.json');
const PHONE_NUMBER = process.env.PHONE_NUMBER ? process.env.PHONE_NUMBER.trim() : null;

console.log(chalk.green('=============================='));
console.log(chalk.green('  QUEEN_ANITA-V5 STARTING  '));
console.log(chalk.green('=============================='));

let sock;
let isPairingRequested = false;

async function startBot() {
    let authState = { creds: {}, keys: {} };
    if (fs.existsSync(SESSION_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
            authState = { creds: data.creds || {}, keys: data.keys || {} };
        } catch (e) {
            console.log(chalk.yellow('⚠️ Session file imeharibika, itafutwa...'));
            fs.unlinkSync(SESSION_FILE);
        }
    }

    sock = makeWASocket({
        auth: {
            creds: authState.creds,
            keys: authState.keys,
            saveCreds: () => {
                const newState = { creds: sock.authState.creds, keys: sock.authState.keys };
                fs.writeFileSync(SESSION_FILE, JSON.stringify(newState, null, 2));
                console.log(chalk.green('💾 Session imehifadhiwa'));
            }
        },
        printQRInTerminal: false,
        browser: Browsers.windows('Chrome'),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log(chalk.green(`🟢 BOT ONLINE - ${sock.user?.id || 'unknown'}`));
            isPairingRequested = false;
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(chalk.red(`🔴 CONNECTION CLOSED (${statusCode})`));
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log(chalk.yellow('🔄 Reconnecting in 5 seconds...'));
                setTimeout(startBot, 5000);
            } else {
                console.log(chalk.red('❌ Logged out. Futa session.json na uanze upya.'));
            }
        }
        if (!sock.authState.creds.registered && !isPairingRequested && PHONE_NUMBER) {
            isPairingRequested = true;
            console.log(chalk.blue('⏳ Inaomba pairing code...'));
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log(chalk.green(`🔑 PAIRING CODE: ${code}`));
            } catch (err) {
                console.error(chalk.red('❌ Pairing error:'), err.message);
            }
        }
    });
    console.log(chalk.yellow('[✓] Bot initializing...'));
}
startBot();