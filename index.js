'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } =
require('@whiskeysockets/baileys');

const BASE_DIR = process.cwd();
const SESSION_DIR = process.env.SESSION_DIR || path.join(BASE_DIR, 'session');

console.log(chalk.green('=============================='));
console.log(chalk.green('  QUEEN_ANITA-V5 STARTING  '));
console.log(chalk.green('=============================='));

async function startBot() {
    try {

        // ensure session folder exists
        if (!fs.existsSync(SESSION_DIR)) {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(chalk.green('🟢 QUEEN_ANITA-V5 IS ONLINE'));
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;

                console.log(chalk.red('🔴 CONNECTION CLOSED, RESTARTING...'));

                // auto restart
                if (reason !== DisconnectReason.loggedOut) {
                    startBot();
                }
            }
        });

        console.log(chalk.yellow('[✓] Bot initializing...'));

    } catch (err) {
        console.error(chalk.red('BOT ERROR:'), err.message);
    }
}

startBot();