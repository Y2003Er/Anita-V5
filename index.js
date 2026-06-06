'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { Pool } = require('pg');
const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const SESSION_DIR = process.env.SESSION_DIR || './session';
const PHONE_NUMBER = process.env.PHONE_NUMBER?.trim();

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// Clear any junk files (like dcx.js) from session folder
fs.readdirSync(SESSION_DIR).forEach(file => {
    if (!file.endsWith('.json')) {
        console.log(chalk.yellow(`⚠️ Removing unexpected file: ${file}`));
        fs.unlinkSync(path.join(SESSION_DIR, file));
    }
});

console.log(chalk.green('=============================='));
console.log(chalk.green('  QUEEN_ANITA-V5 STARTING    '));
console.log(chalk.green('=============================='));

if (!PHONE_NUMBER) {
    console.log(chalk.red('❌ PHONE_NUMBER not set in .env'));
    process.exit(1);
}

let isReconnecting = false;

async function startBot() {
    if (isReconnecting) return;
    isReconnecting = true;

    // Clean session of any non-JSON files before loading
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
            console.log(chalk.green(`🟢 BOT ONLINE - ${sock.user?.id}`));
            isReconnecting = false;
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(chalk.red(`🔴 CONNECTION CLOSED (${code})`));
            isReconnecting = false;

            if (code === DisconnectReason.loggedOut) {
                console.log(chalk.red('❌ Logged out. Clearing session...'));
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                fs.mkdirSync(SESSION_DIR, { recursive: true });
                setTimeout(startBot, 3000);
            } else {
                console.log(chalk.yellow('🔄 Reconnecting in 5 seconds...'));
                setTimeout(startBot, 5000);
            }
        }
    });

    if (!state.creds.registered) {
        console.log(chalk.blue('⏳ Waiting 6 seconds before requesting pairing code...'));
        await new Promise(r => setTimeout(r, 6000));

        try {
            const code = await sock.requestPairingCode(PHONE_NUMBER);
            console.log(chalk.green(`\n🔑 PAIRING CODE: ${code}`));
            console.log(chalk.cyan('Enter this in WhatsApp > Linked Devices > Link with phone number\n'));
        } catch (err) {
            console.error(chalk.red('❌ Pairing failed:'), err.message);
            sock.end();
            isReconnecting = false;
            setTimeout(startBot, 10000);
        }
    } else {
        console.log(chalk.green('✅ Session valid. Connecting...'));
    }
}

startBot();