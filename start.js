'use strict';

require('dotenv').config();
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');

console.log("🔥 START.JS LOADED");

const BASE_DIR = process.cwd();
const SESSION_DIR = process.env.SESSION_DIR || path.join(BASE_DIR, 'session');

// ensure session folder exists
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    console.log('[session] created');
}

console.log(chalk.green('=============================='));
console.log(chalk.green('  QUEEN_ANITA-V5 INITIALIZING  '));
console.log(chalk.green('=============================='));

console.log('[start] launching index.js');

// launch bot engine
require('./index.js');