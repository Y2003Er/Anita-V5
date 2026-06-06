'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

const SESSION_DIR = path.resolve(process.env.SESSION_DIR || './session');
const PHONE_NUMBER = process.env.PHONE_NUMBER?.trim();

// Unda folder ya session
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// Futa files zisizo za JSON kwenye session
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
    console.log(chalk.red('❌ PHONE_NUMBER haipo kwenye .env'));
    process.exit(1);
}

let isReconnecting = false;

async function startBot() {
    if (isReconnecting) return;
    isReconnecting = true;

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
                console.log(chalk.red('❌ Logged out. Inafuta session...'));
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                fs.mkdirSync(SESSION_DIR, { recursive: true });
                setTimeout(startBot, 3000);
            } else {
                console.log(chalk.yellow('🔄 Reconnecting baada ya sekunde 5...'));
                setTimeout(startBot, 5000);
            }
        }
    });

    if (!state.creds.registered) {
        console.log(chalk.blue('⏳ Inasubiri sekunde 6 kabla ya pairing...'));
        await new Promise(r => setTimeout(r, 6000));

        try {
            const code = await sock.requestPairingCode(PHONE_NUMBER);
            console.log(chalk.green(`\n🔑 PAIRING CODE: ${code}`));
            console.log(chalk.cyan('Weka code hii: WhatsApp > Linked Devices > Link with phone number\n'));
        } catch (err) {
            console.error(chalk.red('❌ Pairing imeshindwa:'), err.message);
            sock.end();
            isReconnecting = false;
            setTimeout(startBot, 10000);
        }
    } else {
        console.log(chalk.green('✅ Session ipo. Inaunganisha...'));
    }
}

startBot();