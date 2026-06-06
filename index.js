'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const SESSION_FILE = path.join(process.cwd(), 'session.json');
const PHONE_NUMBER = process.env.PHONE_NUMBER ? process.env.PHONE_NUMBER.trim() : null;

let validationErrorCount = 0;

console.log(chalk.green('=============================='));
console.log(chalk.green('  QUEEN_ANITA-V5 STARTING  '));
console.log(chalk.green('=============================='));

// ------------------------------------------------------------
// 1. Futa session.json ikiwa ipo na ni batili (au imeharibika)
// ------------------------------------------------------------
if (fs.existsSync(SESSION_FILE)) {
  try {
    const test = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    if (!test.creds || !test.creds.registered) {
      console.log(chalk.yellow('⚠️ Session iliyopo haijasajiliwa au ni batili. Inafutwa...'));
      fs.unlinkSync(SESSION_FILE);
    }
  } catch (e) {
    console.log(chalk.yellow('⚠️ Session faili imeharibika. Inafutwa...'));
    fs.unlinkSync(SESSION_FILE);
  }
}

// ------------------------------------------------------------
// 2. Kazi za kusaidia
// ------------------------------------------------------------
function loadAuthState() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      return { creds: data.creds || {}, keys: data.keys || {} };
    }
  } catch (e) {}
  return { creds: {}, keys: {} };
}

function saveAuthState(state) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2));
    console.log(chalk.green('💾 Session imehifadhiwa'));
  } catch (e) {}
}

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
        creds: authState.creds,
        keys: authState.keys,
        saveCreds: () => {
          const newState = {
            creds: sock.authState.creds,
            keys: sock.authState.keys
          };
          saveAuthState(newState);
          // Reset validation counter upon successful save
          validationErrorCount = 0;
        }
      },
      printQRInTerminal: false,
      browser: ['AnitaV5', 'Chrome', '120.0.0'],
      // Ongeza timeout ili kuepuka kushindwa mapema
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        console.log(chalk.green(`🟢 BOT ONLINE - ${sock.user?.id || 'unknown'}`));
        validationErrorCount = 0;
      }

      if (connection === 'close') {
        const error = lastDisconnect?.error;
        const statusCode = error?.output?.statusCode;
        const isValidationError = error?.message?.includes('validation') || statusCode === 403;

        console.log(chalk.red('🔴 CONNECTION CLOSED'), statusCode ? `(${statusCode})` : '');

        if (isValidationError) {
          validationErrorCount++;
          console.log(chalk.yellow(`⚠️ Validation error #${validationErrorCount}`));
          if (validationErrorCount >= 3) {
            console.log(chalk.red('❌ Session batili kabisa. Inafutwa na kuanza upya...'));
            try { fs.unlinkSync(SESSION_FILE); } catch(e) {}
            validationErrorCount = 0;
            setTimeout(() => startBot(), 2000);
            return;
          }
        }

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log(chalk.yellow('🔄 Reconnecting in 5 seconds...'));
          setTimeout(startBot, 5000);
        } else {
          console.log(chalk.red('❌ Ume logout. Futa session.json na uanze upya.'));
        }
      }
    });

    // --------------------------------------------------------
    // 4. Omba pairing code ikiwa hakuna session halali
    // --------------------------------------------------------
    const isRegistered = authState.creds && authState.creds.registered === true;
    if (!isRegistered && PHONE_NUMBER) {
      console.log(chalk.blue('⏳ Subiri sekunde 3 kwa muunganisho...'));
      await new Promise(r => setTimeout(r, 3000));
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log(chalk.green(`🔑 PAIRING CODE: ${code}`));
        console.log(chalk.cyan('💡 Ingiza code hii kwenye WhatsApp (Mipangilio > Vifaa Vilivyounganishwa > Unganisha kwa namba)'));
      } catch (err) {
        console.error(chalk.red('❌ Kosa la pairing:'), err.message);
        if (err.message.includes('public')) {
          console.log(chalk.red('⚠️ Tatizo la toleo la Baileys. Jaribu kusasisha: npm install @whiskeysockets/baileys@latest'));
        }
      }
    } else if (!isRegistered) {
      console.log(chalk.red('❌ Hakuna session na hakuna PHONE_NUMBER kwenye .env. Weka PHONE_NUMBER na uanze tena.'));
      process.exit(1);
    } else {
      console.log(chalk.green('✅ Session halisi ipo. Hakuna pairing inayohitajika.'));
    }

    console.log(chalk.yellow('[✓] Bot initializing...'));

  } catch (err) {
    console.error(chalk.red('BOT ERROR:'), err);
    setTimeout(startBot, 5000);
  }
}

startBot();