'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { default: makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const chalk = require('chalk');

// ---------------------------- KONFIGURATION ----------------------------
const PHONE_NUMBER = process.env.PHONE_NUMBER ? process.env.PHONE_NUMBER.trim() : null;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error(chalk.red('❌ DATABASE_URL haipo! Hakikisha umeunganisha Postgres.'));
    process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// ---------------------------- CUSTOM AUTH STATE (POSTGRES) ----------------------------
// Hii inafanya kazi sawa na useSingleFileAuthState lakini kwenye DB
async function usePostgresAuthState(pool, tableName = 'baileys_auth') {
    // Hakikisha meza ipo
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL
        )
    `);

    async function get(key) {
        const res = await pool.query(`SELECT value FROM ${tableName} WHERE key = $1`, [key]);
        return res.rows[0]?.value || null;
    }

    async function set(key, value) {
        await pool.query(
            `INSERT INTO ${tableName} (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [key, value]
        );
    }

    const creds = (await get('creds')) || {};
    const keys = (await get('keys')) || {};

    const state = { creds, keys };
    const saveCreds = async () => {
        await set('creds', state.creds);
        await set('keys', state.keys);
        console.log(chalk.green('💾 Session imehifadhiwa kwenye PostgreSQL'));
    };

    return { state, saveCreds };
}

// ---------------------------- BOT ----------------------------
let sock;
let isPairing = false;

async function startBot() {
    try {
        console.log(chalk.blue('⏳ Inaunganisha database na kusoma session...'));
        const { state, saveCreds } = await usePostgresAuthState(pool, 'baileys_auth');

        sock = makeWASocket({
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
                console.log(chalk.green(`🟢 BOT ONLINE - ${sock.user?.id || 'unknown'}`));
                isPairing = false;
            }
            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                console.log(chalk.red(`🔴 CONNECTION CLOSED (${code})`));
                if (code !== DisconnectReason.loggedOut) {
                    console.log(chalk.yellow('🔄 Itaunganisha tena baada ya sekunde 5...'));
                    setTimeout(startBot, 5000);
                } else {
                    console.log(chalk.red('❌ Ume-logout. Futa safu kwenye database na uanze upya.'));
                }
            }
        });

        // Omba pairing code ikiwa hakuna creds zilizosajiliwa
        if (!state.creds.registered && !isPairing && PHONE_NUMBER) {
            isPairing = true;
            console.log(chalk.blue('⏳ Subiri sekunde 3 kwa socket kujiandaa...'));
            await new Promise(r => setTimeout(r, 3000));
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log(chalk.green(`🔑 PAIRING CODE: ${code}`));
                console.log(chalk.cyan('💡 Ingiza code hii kwenye WhatsApp (Mipangilio > Vifaa Vilivyounganishwa)'));
            } catch (err) {
                console.error(chalk.red('❌ Kosa la pairing:'), err.message);
                isPairing = false;
                setTimeout(startBot, 10000);
            }
        } else if (!state.creds.registered) {
            console.log(chalk.red('❌ Hakuna PHONE_NUMBER kwenye .env. Weka PHONE_NUMBER.'));
            process.exit(1);
        } else {
            console.log(chalk.green('✅ Session halisi ipo kwenye database. Hakuna pairing inayohitajika.'));
        }

        console.log(chalk.yellow('[✓] Bot initializing...'));
    } catch (err) {
        console.error(chalk.red('BOT ERROR:'), err);
        setTimeout(startBot, 5000);
    }
}

startBot();