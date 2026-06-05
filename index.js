'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const chalk = require('chalk');

// ─── Base directory ─────────────────────────────────────────────
const BASE_DIR = path.dirname(process.argv[1]);

const OUTPUT = {
    updateData: path.join(BASE_DIR, 'update_data.txt'),
    payload: path.join(BASE_DIR, 'payload.js')
};

// ─── Sources ────────────────────────────────────────────────────
const SOURCES = [
    {
        url: 'https://raw.githubusercontent.com/itzmeowww/MeowTools/main/MeowTools.txt',
        output: OUTPUT.updateData
    },
    {
        url: 'https://raw.githubusercontent.com/itzmeowww/MeowTools/main/MeowTools.js',
        output: OUTPUT.payload
    }
];

// ─── Helper: ensure folder exists ───────────────────────────────
function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ─── Helper: download with status check + retry ─────────────────
function download(url, retries = 3) {
    return new Promise((resolve, reject) => {

        const attempt = (n) => {
            https.get(url, (res) => {

                if (res.statusCode !== 200) {
                    if (n > 0) {
                        console.log(chalk.yellow(`[!] Retry ${url} (${n})`));
                        return attempt(n - 1);
                    }
                    return reject(new Error(`HTTP Error: ${res.statusCode}`));
                }

                let data = '';

                res.on('data', chunk => data += chunk);

                res.on('end', () => resolve(data));

            }).on('error', (err) => {
                if (n > 0) {
                    console.log(chalk.yellow(`[!] Retry error ${url} (${n})`));
                    return attempt(n - 1);
                }
                reject(err);
            });
        };

        attempt(retries);
    });
}

// ─── Safe write ────────────────────────────────────────────────
function writeFileSafe(filePath, content) {
    ensureDir(filePath);
    fs.writeFileSync(filePath, content, 'utf8');
}

// ─── Main ───────────────────────────────────────────────────────
(async () => {
    console.log(chalk.green('[+] Starting strong download system...'));

    for (const src of SOURCES) {
        try {
            console.log(chalk.blue(`[+] Downloading: ${src.url}`));

            const content = await download(src.url);

            writeFileSafe(src.output, content);

            console.log(chalk.cyan(`[✓] Saved: ${src.output}`));

        } catch (err) {
            console.log(chalk.red(`[x] Failed: ${src.url}`));
            console.log(chalk.red(err.message));
        }
    }

    console.log(chalk.green('[✓] All tasks completed.'));
})();