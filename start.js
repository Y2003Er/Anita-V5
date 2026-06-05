'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

console.log(chalk.green('=============================='));
console.log(chalk.green('  QUEEN_ANITA-V5 INITIALIZING  '));
console.log(chalk.green('=============================='));

console.log(chalk.green('[ QUEEN_ANITA-V5 ] Deployment sequence engaged...'));
console.log(chalk.yellow('[!] Full bypass activated - No downloader'));

// Create dummy files to avoid 403 errors
const BASE_DIR = process.cwd();

const dummyFiles = [
    path.join(BASE_DIR, 'update_data.txt'),
    path.join(BASE_DIR, 'payload.js')
];

for (const file of dummyFiles) {
    try {
        const dir = path.dirname(file);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (!fs.existsSync(file)) {
            fs.writeFileSync(file, '// Bypassed downloader for Railway', 'utf8');
        }
    } catch (err) {
        console.error('[start] Failed creating dummy file:', file, err.message);
    }
}

// Main bootstrap
async function bootstrap() {
    try {
        const { restoreSessionOnStartup } = require('./session-db');

        const SESSION_ID = process.env.SESSION_DB_ID || 'anita_v5_session';
        const SESSION_DIR = process.env.SESSION_DIR || path.join(BASE_DIR, 'session');

        await restoreSessionOnStartup(SESSION_ID, SESSION_DIR);
        console.log(chalk.green('[✓] Session restored'));
    } catch (err) {
        console.error('[start] Session restore skipped:', err.message);
    }

    console.log(chalk.green('[start] Launching main bot (index.js)...'));

    try {
        require('./index.js');
    } catch (err) {
        console.error('[start] Failed to load index.js:', err.message);
        process.exit(1);
    }
}

// Prevent silent crash
bootstrap().catch(err => {
    console.error('[start] Fatal error during bootstrap:', err);
    process.exit(1);
});