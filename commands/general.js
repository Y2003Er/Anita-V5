// commands/general.js
module.exports = {
    name: 'ping',
    description: 'Check if bot is alive',
    async execute(sock, msg, args) {
        const from = msg.key.remoteJid;
        await sock.sendMessage(from, { text: '🏓 Pong! Bot iko hai.' });
    }
};