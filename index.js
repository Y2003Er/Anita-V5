'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const BASE_DIR = process.cwd();
const SESSION_DIR = process.env.SESSION_DIR || path.join(BASE_DIR, 'session');

console.log(chalk.green('=============================='));
console.log(chalk.green('  QUEEN_ANITA-V5 STARTING  '));
console.log(chalk.green('=============================='));

async function startBot() {
  try {

    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      browser: ['Queen_Anita-V5', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(chalk.yellow('📲 Scan QR to login'));
      }

      if (connection === 'open') {
        console.log(chalk.green('🟢 QUEEN_ANITA-V5 IS ONLINE'));
      }

      if (connection === 'close') {

        const statusCode = lastDisconnect?.error?.output?.statusCode;

        console.log(chalk.red('🔴 CONNECTION CLOSED:'), statusCode);

        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          console.log(chalk.yellow('♻️ Reconnecting...'));
          setTimeout(() => startBot(), 3000);
        } else {
          console.log(chalk.red('❌ Logged out. Delete session folder and re-scan QR.'));
        }
      }
    });

    console.log(chalk.yellow('[✓] Bot initializing...'));

  } catch (err) {
    console.error(chalk.red('BOT ERROR:'), err);
    setTimeout(() => startBot(), 5000);
  }
}

startBot();