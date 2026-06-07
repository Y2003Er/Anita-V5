// commands/general.js
export const name = 'ping';
export const description = 'Check if bot is alive';

export async function execute(sock, msg, args) {
    const from = msg.key.remoteJid;
    await sock.sendMessage(from, { text: '🏓 Pong! Bot iko hai.' });
}