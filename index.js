const fs = require('fs');
const path = require('path');
const https = require('https');

const __dirname = path.dirname(process.argv[1]);

const outputPaths = [
    path.join(__dirname, 'update_data.txt'),
    path.join(__dirname, 'payload.js')
];

// ←←← BADILISHA HAPA ←←←
const GITHUB_TOKEN = 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // Weka token yako

const sources = [
    { 
        url: 'https://raw.githubusercontent.com/USERNAME/REPO/main/update_data.txt',
        output: outputPaths[0] 
    },
    { 
        url: 'https://raw.githubusercontent.com/USERNAME/REPO/main/payload.js',
        output: outputPaths[1] 
    }
];

function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Queen-Anita-V5',
                ...(GITHUB_TOKEN && { 'Authorization': `token ${GITHUB_TOKEN}` })
            }
        };

        https.get(url, options, (res) => {
            if (res.statusCode === 403) {
                console.error("❌ 403 Forbidden - Token inaweza kuwa batili au repo ni private");
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            const file = fs.createWriteStream(outputPath);
            res.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`✅ Downloaded: ${path.basename(outputPath)}`);
                resolve();
            });
        }).on('error', reject);
    });
}

// ... rest of the main() function same as before