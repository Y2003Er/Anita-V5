'use strict';

const fs = require('fs');
const path = require('path');

let commands = new Map();

// ================= LOAD COMMANDS =================
function loadCommands() {
    const commandsPath = path.join(__dirname, '../commands');
    if (!fs.existsSync(commandsPath)) return;

    const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

    for (const file of files) {
        try {
            const cmd = require(path.join(commandsPath, file));

            if (cmd.name && typeof cmd.execute === 'function') {
                commands.set(cmd.name, cmd);
                console.log(`✅ Command loaded: ${cmd.name}`);
            }
        } catch (err) {
            console.error(`❌ Failed to load command ${file}:`, err.message);
        }
    }
}

// ================= GET COMMAND =================
function getCommand(name) {
    return commands.get(name);
}

// ================= HANDLE MESSAGE =================
async function handleMessage(sock, msg) {
    try {
        const from = msg.key.remoteJid;

        const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

        if (!text) return;

        const prefix = global.prefix || '.';
        if (!text.startsWith(prefix)) return;

        const args = text.slice(prefix.length).trim().split(/\s+/);
        const cmdName = args.shift()?.toLowerCase();

        const cmd = getCommand(cmdName);
        if (!cmd) return;

        await cmd.execute(sock, msg, args);

    } catch (err) {
        console.error('Message handler error:', err);
    }
}

// ================= REAL CONTACT LISTENER =================
function setupContactListener(sock) {
    if (!sock || !sock.ev) return;

    const contactCache = new Map();

    sock.ev.on('contacts.update', (contacts) => {
        if (!Array.isArray(contacts)) return;

        for (const c of contacts) {
            const jid = c.id || c.jid;
            if (!jid) continue;

            contactCache.set(jid, {
                name: c.notify || c.name || '',
                verifiedName: c.verifiedName || '',
                imgUrl: c.imgUrl || null,
                updatedAt: Date.now()
            });
        }
    });

    // expose globally for other modules if needed
    global.contactCache = contactCache;
}

// ================= EXPORTS =================
module.exports = {
    loadCommands,
    handleMessage,
    setupContactListener
};