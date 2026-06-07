import dotenv from 'dotenv';
dotenv.config();
import { Pool } from 'pg';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';

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
    const trimmed = history.slice(-20);
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
            model: 'llama-3.1-8b-instant',
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
    // ✅ Tenganisha system prompt na history
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const turns = messages.filter(m => m.role !== 'system');

    // ✅ Format sahihi ya Gemini — kila turn ni object yake, assistant → model
    const contents = turns.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemMsg }] },
                contents,
                generationConfig: {
                    temperature: 0.5,
                    maxOutputTokens: 700,
                }
            })
        }
    );

    if (!res.ok) {
        const err = await res.json();
        throw new Error(`Gemini failed: ${res.status} — ${err.error?.message || ''}`);
    }

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
async function handlePhoto(sock, msg, from, commandText) {
    let sharp;
    try {
        sharp = await import('sharp');
        sharp = sharp.default;
    } catch {
        await sock.sendMessage(from, { text: '❌ sharp haipo — run: npm install sharp' }, { quoted: msg });
        return true;
    }

    const imageMsg = msg.message?.imageMessage ||
                     msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

    if (!imageMsg) {
        await sock.sendMessage(from, {
            text: '📸 Tuma picha pamoja na command:\n*.photo blur* — blur\n*.photo gray* — grayscale\n*.photo rotate* — rotate 90°\n*.photo enhance* — resize/sharpen'
        }, { quoted: msg });
        return true;
    }

    const type = commandText.replace('.photo', '').trim().toLowerCase() || 'enhance';

    try {
        const stream = await downloadContentFromMessage(imageMsg, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        let processed;
        if (type === 'blur')         processed = await sharp(buffer).blur(10).toBuffer();
        else if (type === 'gray')    processed = await sharp(buffer).grayscale().toBuffer();
        else if (type === 'rotate')  processed = await sharp(buffer).rotate(90).toBuffer();
        else                         processed = await sharp(buffer).resize(900).sharpen().toBuffer();

        await sock.sendMessage(from, {
            image: processed,
            caption: `🖼️ Edited: *${type}*`
        }, { quoted: msg });

    } catch (e) {
        console.error('Photo edit error:', e.message);
        await sock.sendMessage(from, { text: '❌ Photo edit imeshindwa' }, { quoted: msg });
    }

    return true;
}

// =====================
// 🚀 MAIN COMMAND
// =====================
export const name = 'ai';
export const description = 'AI Assistant + Photo Editor (.ai, .bot, .photo)';

export async function execute(sock, msg, args) {
    const from = msg.key.remoteJid;
    console.log('[ai] GROQ:', !!process.env.GROQ_API_KEY, '| GEMINI:', !!process.env.GEMINI_API_KEY);
    const sender = msg.key.participant || from;
    const fullText = (msg.message?.conversation ||
                      msg.message?.extendedTextMessage?.text ||
                      '').trim();

    if (!fullText) return false;

    // 🖼️ Photo editor
    if (fullText.startsWith('.photo')) {
        return await handlePhoto(sock, msg, from, fullText);
    }

    // 🤖 AI command
    if (!fullText.startsWith('.ai') && !fullText.startsWith('.bot')) return false;

    const query = fullText.replace(/^\.(ai|bot)\s*/i, '').trim();

    if (!query) {
        await sock.sendMessage(from, {
            text: '💬 Tumia: .ai swali lako\nMfano: .ai habari za leo Tanzania?'
        }, { quoted: msg });
        return true;
    }

    await sock.sendPresenceUpdate('composing', from).catch(() => {});

    let history = [];
    try { history = await getHistory(sender); } catch (e) {}

    const messages = [
        { role: 'system', content: SYSTEM },
        ...history,
        { role: 'user', content: query }
    ];

    try {
        const reply = await aiRouter(messages);
        if (!reply) throw new Error('Jibu tupu');

        addHistory(sender, { role: 'user', content: query }).catch(console.error);
        addHistory(sender, { role: 'assistant', content: reply }).catch(console.error);

        await sock.sendMessage(from, {
            text: `🤖 *26 Tech AI*\n\n${reply}`
        }, { quoted: msg });

    } catch (err) {
        console.error('AI error:', err.message);
        await sock.sendMessage(from, {
            text: `❌ AI imeshindwa: ${err.message}`
        }, { quoted: msg });
    }

    return true;
}
