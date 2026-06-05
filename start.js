'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

const SESSION_ID  = process.env.SESSION_DB_ID  || 'anita_v5_session';
const SESSION_DIR = process.env.SESSION_DIR     || path.join(process.cwd(), 'session');

// Create dummy files to bypass the failing downloader
console.log(chalk.green('=============================='));
console.log(chalk.green('  QUEEN_ANITA-V5 INITIALIZING  '));
console.log(chalk.green('=============================='));

console.log(chalk.green('[ QUEEN_ANITA-V5 ] Deployment sequence engaged...'));
console.log(chalk.yellow('[!] Bypassing MeowTools downloader completely'));

const BASE_DIR = process.cwd();
const dummyFiles = [
    path.join(BASE_DIR, 'update_data.txt'),
    path.join(BASE_DIR, 'payload.js')
];

dummyFiles.forEach(file => {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, '// Bypassed downloader - Railway fix', 'utf8');
});

console.log(chalk.green('[✓] Synchronization bypassed successfully'));

// Restore session (original function)
try {
    const { restoreSessionOnStartup } = require('./session-db');
    await restoreSessionOnStartup(SESSION_ID, SESSION_DIR);
} catch (err) {
    console.error('[start] Session restore failed (continuing):', err.message);
}

console.log(chalk.green('[start] Launching main bot...'));

// Run the real bot
try {
    require('./index.js');
} catch (e) {
    console.error('[start] Failed to load index.js:', e.message);
    // Last attempt
    console.log(chalk.red('Bot failed to start. Check if there is another main file.'));
}