
// lib/handler.js
const fs = require('fs');
const path = require('path');

let commands = new Map();

// Load all command files from /commands folder
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

// Get command by name
function getCommand(name) {
    return commands.get(name);
}

// Handle incoming message
async function handleMessage(sock, msg) {
    const from = msg.key.remoteJid;
    const text = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || '';
    
    if (!text.startsWith(global.prefix || '.')) return; // ignore non-commands
    
    const args = text.slice(1).trim().split(/\s+/);
    const cmdName = args.shift().toLowerCase();
    
    const cmd = getCommand(cmdName);
    if (!cmd) return;
    
    try {
        await cmd.execute(sock, msg, args);
    } catch (err) {
        console.error(`Error executing command ${cmdName}:`, err);
        await sock.sendMessage(from, { text: '❌ Command ilishindwa.' });
    }
}

module.exports = { loadCommands, handleMessage };