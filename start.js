'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

console.log("🔥 START.JS LOADED");

const BASE_DIR = process.cwd();

// bootstrap function
async function bootstrap() {
    console.log(chalk.green('=============================='));
    console.log(chalk.green('  QUEEN_ANITA-V5 INITIALIZING  '));
    console.log(chalk.green('=============================='));

    try {
        const { restoreSessionOnStartup } = require('./session-db');

        const SESSION_ID = process.env.SESSION_DB_ID || 'anita_v5_session';
        const SESSION_DIR = process.env.SESSION_DIR || path.join(BASE_DIR, 'session');

        await restoreSessionOnStartup(SESSION_ID, SESSION_DIR);

        console.log(chalk.green('[✓] Session restored'));
    } catch (err) {
        console.log('[start] Session restore skipped:', err.message);
    }

    console.log('[start] launching index.js');

    require('./index.js');
}

bootstrap().catch(err => {
    console.error('BOOTSTRAP FAILED:', err);
});