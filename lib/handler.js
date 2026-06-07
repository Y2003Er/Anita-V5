import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let commands = new Map();

// ================= LOAD COMMANDS =================
export function loadCommands() {
    const commandsPath = path.join(__dirname, '../commands');
    if (!fs.existsSync(commandsPath)) return;

    const files = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

    for (const file of files) {
        try {
            // Dynamic import for ES modules
            const cmdPath = path.join(commandsPath, file);
            const cmd = await import(`file://${cmdPath}`);
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
export async function handleMessage(sock, msg) {
    try {
        // Extract JID (works with LID or group JID)
        const chatJid = msg.key.remoteJid;
        // For group messages, the sender's LID is in participant
        const senderLid = msg.key.participant || chatJid;

        // Extract text
        const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

        if (!text) return;

        // Get prefix (fallback to '.' if not set)
        const prefix = global.prefix || '.';
        if (!text.startsWith(prefix)) return;

        const args = text.slice(prefix.length).trim().split(/\s+/);
        const cmdName = args.shift()?.toLowerCase();

        const cmd = getCommand(cmdName);
        if (!cmd) return;

        // Pass the socket, full message object, and arguments
        // Also attach the sender LID for convenience (commands can use it)
        msg.senderLid = senderLid;
        await cmd.execute(sock, msg, args);

    } catch (err) {
        console.error('Message handler error:', err);
    }
}

// ================= CONTACT LISTENER (v7 compatible) =================
export function setupContactListener(sock) {
    if (!sock || !sock.ev) return;

    const contactCache = new Map();

    sock.ev.on('contacts.update', (contacts) => {
        if (!Array.isArray(contacts)) return;

        for (const c of contacts) {
            // v7 uses 'id' as the LID
            const lid = c.id;
            if (!lid) continue;

            contactCache.set(lid, {
                name: c.notify || c.name || '',
                verifiedName: c.verifiedName || '',
                imgUrl: c.imgUrl || null,
                jid: c.jid || null,      // may include phone number
                updatedAt: Date.now()
            });
        }
    });

    // Expose helper to convert LID → phone number if needed
    global.contactCache = contactCache;
    global.getPhoneNumberFromLid = async (sock, lid) => {
        try {
            const info = await sock.getLid(lid);
            return info?.jid || null;
        } catch {
            return null;
        }
    };
}