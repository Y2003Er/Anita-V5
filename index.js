import dotenv from 'dotenv';
dotenv.config();

import pino from 'pino';
import NodeCache from 'node-cache';
import {
    default as makeWASocket,
    DisconnectReason,
    Browsers,
    useMultiFileAuthState,
} from '@whiskeysockets/baileys';

// Import local modules (lazima ziwe ES modules)
import './config.js';
import { loadCommands, handleMessage, setupContactListener } from './lib/handler.js';

const logger = pino({ level: 'info' });
const PHONE_NUMBER = process.env.PHONE_NUMBER?.trim();

const log = {
    info:    (msg) => console.log(`  ✦  ${msg}`),
    success: (msg) => console.log(`  ✔  ${msg}`),
    warn:    (msg) => console.log(`  ⚠  ${msg}`),
    error:   (msg) => console.log(`  ✖  ${msg}`),
    state:   (msg) => console.log(`  ◈  ${msg}`),
    div:     ()    => console.log(`  ${'─'.repeat(46)}`),
    blank:   ()    => console.log(''),
};

log.blank();
console.log('  ╔════════════════════════════════════════════╗');
console.log('  ║       QUEEN_ANITA-V5   ·   RUNTIME         ║');
console.log('  ║       WhatsApp Bot   ·   Baileys v7        ║');
console.log('  ║       Session  ·   Local Folder (./session)║');
console.log('  ╚════════════════════════════════════════════╝');
log.blank();

if (!PHONE_NUMBER || !/^\d{10,15}$/.test(PHONE_NUMBER)) {
    log.error('PHONE_NUMBER si sahihi (mfano: 255753595142)');
    process.exit(1);
}

let sock = null;
let isConnecting = false;
let pairingRequested = false;
let bootLock = false;
let openTimer = null;

function clearOpenTimer() {
    if (openTimer) clearTimeout(openTimer);
    openTimer = null;
}

function displayPairingCode(code) {
    console.log('\n╔══════════════════════════╗');
    console.log('║   🔑 PAIRING CODE        ║');
    console.log('╠══════════════════════════╣');
    console.log(`║      ${code}      ║`);
    console.log('╚══════════════════════════╝');
    console.log(`\n📋 CODE: ${code}\n`);
    console.log('👆 WhatsApp → Linked Devices → Link a Device');
    console.log('👆 Link with phone number → Weka namba yako');
    console.log('👆 Popup itatokea yenyewe — bonyeza CONFIRM\n');
}

async function startBot() {
    if (bootLock || isConnecting) return;
    if (sock?.ws?.readyState === 1) return;

    bootLock = true;
    isConnecting = true;
    pairingRequested = false;
    clearOpenTimer();

    try {
        loadCommands();
        log.success('Commands zimepakiwa.');

        // Session local folder
        const { state, saveCreds } = await useMultiFileAuthState('./session');
        const msgRetryCounterCache = new NodeCache();

        if (sock) {
            try {
                sock.ev.removeAllListeners();
                await sock.ws?.close();
                sock.end?.(new Error('Restarting'));
            } catch (e) {}
            sock = null;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        sock = makeWASocket({
            auth: state,
            msgRetryCounterCache,
            logger,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 120000,
            keepAliveIntervalMs: 30000,
            defaultQueryTimeoutMs: undefined,
            generateHighQualityLinkPreview: false,
            patchMessageBeforeSending: (msg) => msg,
        });

        sock.ev.on('creds.update', saveCreds);
        setupContactListener(sock);

        // Event: connection update (imebadilishwa kidogo kwa v7)
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection) log.state(`Connection  →  ${connection}`);

            // Kwa v7, tumia state.creds?.account badala ya state.creds?.me
            const isRegistered = !!state.creds?.account;
            if (!pairingRequested && !isRegistered && connection === 'connecting') {
                pairingRequested = true;
                setTimeout(async () => {
                    try {
                        console.log(`📱 Inaomba pairing code kwa: ${PHONE_NUMBER}`);
                        const code = await sock.requestPairingCode(PHONE_NUMBER);
                        displayPairingCode(code);
                    } catch (err) {
                        console.error('❌ Pairing code imeshindwa:', err.message);
                        pairingRequested = false;
                    }
                }, 1000);
            }

            if (connection === 'open') {
                clearOpenTimer();
                log.div();
                log.success('BOT IMEUNGANIKA ✔');
                log.success('Session imehifadhiwa kwenye folder ./session');
                log.div();
                isConnecting = false;
                bootLock = false;
            }

            if (connection === 'close') {
                clearOpenTimer();
                const code = lastDisconnect?.error?.output?.statusCode;
                log.div();
                log.error(`Muunganiko Umevunjika → [${code ?? '?'}]`);
                isConnecting = false;
                bootLock = false;

                if (code === 440) {
                    log.warn('Connection replaced (440) – waiting 15s before restart');
                    setTimeout(startBot, 15000);
                } else if (code === DisconnectReason.loggedOut || code === 401) {
                    log.warn('Session invalid. Inafuta folder ./session...');
                    import('fs').then(fs => fs.promises.rm('./session', { recursive: true, force: true })).catch(()=>{});
                    setTimeout(startBot, 10000);
                } else {
                    log.warn('Unknown disconnect – restarting in 7s');
                    setTimeout(startBot, 7000);
                }
            }
        });

        // Message handler
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message) return;
            if (msg.key.fromMe) return;
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[non-text message]';
            console.log(`📩 Ujumbe kutoka ${msg.key.remoteJid}: ${text}`);
            await handleMessage(sock, msg);
        });

        openTimer = setTimeout(() => {
            log.warn('Timeout — restart...');
            isConnecting = false;
            bootLock = false;
            try { sock?.ev?.removeAllListeners(); sock?.ws?.close(); } catch {}
            setTimeout(startBot, 7000);
        }, 180000);

        if (state.creds?.account) {
            log.success('Session ipo folder ./session — Inaunganika...');
        } else {
            log.info('Session mpya — inasubiri pairing...');
        }

    } catch (err) {
        log.error(`HITILAFU → ${err.message}`);
        isConnecting = false;
        bootLock = false;
        setTimeout(startBot, 7000);
    }
}

// Anza bot
startBot().catch(err => {
    log.error(`Start error: ${err.message}`);
    process.exit(1);
});