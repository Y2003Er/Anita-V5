'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// =====================
// 🧠 MEMORY — PostgreSQL
// =====================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function initMemoryTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_memory (
            user_id TEXT PRIMARY KEY,
            history JSONB NOT NULL DEFAULT '[]'
        )
    `);
}
initMemoryTable().catch(console.error);

async function getHistory(userId) {
    const res = await pool.query('SELECT history FROM ai_memory WHERE user_id = $1', [userId]);
    return res.rows[0]?.history || [];
}

async function addHistory(userId, msg) {
    const history = await getHistory(userId);
    history.push(msg);
    const trimmed = history.slice(-20); // hifadhi 20 za mwisho
    await pool.query(`
        INSERT INTO ai_memory (user_id, history) VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET history = $2
    `, [userId, JSON.stringify(trimmed)]);
}

// =====================
// ⚡ AI PROVIDERS
// =====================
async function callGroq(messages) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'llama3-8b-8192',
            messages,
            temperature: 0.5,
            max_tokens: 700,
        })
    });
    if (!res.ok) throw new Error(`Groq failed: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content;
}

async function callGemini(messages) {
    const prompt = messages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
        .join('\n');

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        }
    );
    if (!res.ok) throw new Error(`Gemini failed: ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function aiRouter(messages) {
    if (GROQ_API_KEY) {
        try { return await callGroq(messages); } catch (e) {
            console.warn('Groq failed, trying Gemini:', e.message);
        }
    }
    if (GEMINI_API_KEY) {
        return await callGemini(messages);
    }
    throw new Error('Hakuna API key — weka GROQ_API_KEY au GEMINI_API_KEY');
}

// =====================
// 🤖 SYSTEM PROMPT
// =====================
const SYSTEM = `Wewe ni AI Assistant wa *26 Tech Solution*, ulioundwa na *Yuzzo*.
Jibu kwa Kiswahili au English kulingana na mtumiaji.
Majibu yawe mafupi, smart na ya kusaidia.
Usitumie markdown nyingi — tumia bold (*neno*) tu pale inapohitajika.`;

// =====================
// 🖼️ PHOTO EDITOR
// =====================
async function handlePhoto(sock, msg, from, text, safeSend) {
    let sharp;
    try { sharp = require('sharp'); } catch {
        return safeSend(sock, from, {
            text: '❌ sharp haipo — run: npm install sharp'
        }, { quoted: msg });
    }

    const imageMsg = msg.message?.imageMessage ||
                     msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

    if (!imageMsg) {
        return safeSend(sock, from, {
            text: '📸 Tuma picha pamoja na command:\n*.photo blur* — blur\n*.photo gray* — grayscale\n*.photo rotate* — rotate 90°\n*.photo enhance* — resize/sharpen'
        }, { quoted: msg });
    }

    const type = text.replace('.photo', '').trim().toLowerCase() || 'enhance';
    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

    try {
        const stream = await downloadContentFromMessage(imageMsg, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        let processed;
        if (type === 'blur')         processed = await sharp(buffer).blur(10).toBuffer();
        else if (type === 'gray')    processed = await sharp(buffer).grayscale().toBuffer();
        else if (type === 'rotate')  processed = await sharp(buffer).rotate(90).toBuffer();
        else                         processed = await sharp(buffer).resize(900).sharpen().toBuffer();

        await safeSend(sock, from, {
            image: processed,
            caption: `🖼️ Edited: *${type}*`
        }, { quoted: msg });

    } catch (e) {
        console.error('Photo edit error:', e.message);
        await safeSend(sock, from, { text: '❌ Photo edit imeshindwa' }, { quoted: msg });
    }

    return true;
}

// =====================
// 🚀 MAIN COMMAND
// =====================
module.exports = {
    name: 'ai',
    description: 'AI Assistant + Photo Editor (.ai, .bot, .photo)',

    async execute({ sock, msg, from, sender, text, safeSend }) {
        if (!text) return false;

        // 🖼️ Photo editor
        if (text.startsWith('.photo')) {
            return await handlePhoto(sock, msg, from, text, safeSend);
        }

        // 🤖 AI
        if (!text.startsWith('.ai') && !text.startsWith('.bot')) return false;

        const query = text.replace(/^\.(ai|bot)\s*/i, '').trim();

        if (!query) {
            return safeSend(sock, from, {
                text: '💬 Tumia: .ai swali lako\nMfano: .ai habari za leo Tanzania?'
            }, { quoted: msg });
        }

        await sock.sendPresenceUpdate('composing', from).catch(() => {});

        let history = [];
        try { history = await getHistory(sender); } catch {}

        const messages = [
            { role: 'system', content: SYSTEM },
            ...history,
            { role: 'user', content: query }
        ];

        try {
            const reply = await aiRouter(messages);
            if (!reply) throw new Error('Jibu tupu');

            try {
                await addHistory(sender, { role: 'user', content: query });
                await addHistory(sender, { role: 'assistant', content: reply });
            } catch {}

            return safeSend(sock, from, {
                text: `🤖 *26 Tech AI*\n\n${reply}`
            }, { quoted: msg });

        } catch (err) {
            console.error('AI error:', err.message);
            return safeSend(sock, from, {
                text: `❌ AI imeshindwa: ${err.message}`
            }, { quoted: msg });
        }
    }
};
