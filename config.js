import dotenv from 'dotenv';
import fs from 'fs';
import { color } from './lib/myfunc.js';

dotenv.config();

const toBool = (value) => value === "true";

// ========== EXPORT GLOBALS (kwa ajili ya import) ==========
export const owner = process.env.OWNER_NUMBER;
export const nomerowner = process.env.OWNER_NUMBERS;
export const menu_image = process.env.MENU_IMAGE;
export const ANTI_TEMU = toBool(process.env.ANTI_TEMU);
export const ANTI_TAG = toBool(process.env.ANTI_TAG);
export const bot_name = process.env.BOT_NAME;
export const publicVar = toBool(process.env.PUBLIC);
export const packname = process.env.PACK_NAME;
export const author = process.env.AUTHOR;
export const ANTIDELETE = toBool(process.env.ANTI_DELETE);
export const ANTI_CALL = toBool(process.env.ANTI_CALL);
export const unavailable = toBool(process.env.UNAVAILABLE);
export const available = toBool(process.env.AVAILABLE);
export const autoreadmessages = toBool(process.env.AUTO_READ_MESSAGES);
export const chatbot = toBool(process.env.CHATBOT);
export const autoreact = toBool(process.env.AUTO_REACT);
export const autoTyping = toBool(process.env.AUTO_TYPING);
export const autoViewStatus = toBool(process.env.AUTO_STATUS_VIEW);
export const autoStatusReact = toBool(process.env.AUTO_STATUS_REACT);
export const welcome = toBool(process.env.WELCOME);
export const anticall = toBool(process.env.ANTI_CALL);
export const autobio = toBool(process.env.AUTO_BIO);
export const prefix = process.env.PREFIX;

// ========== PIA WEKA KWA GLOBAL (kwa compatibility ya code nyingine) ==========
global.owner = owner;
global.nomerowner = nomerowner;
global.menu_image = menu_image;
global.ANTI_TEMU = ANTI_TEMU;
global.ANTI_TAG = ANTI_TAG;
global.bot_name = bot_name;
global.public = publicVar;
global.packname = packname;
global.author = author;
global.ANTIDELETE = ANTIDELETE;
global.ANTI_CALL = ANTI_CALL;
global.unavailable = unavailable;
global.available = available;
global.autoreadmessages = autoreadmessages;
global.chatbot = chatbot;
global.autoreact = autoreact;
global.autoTyping = autoTyping;
global.autoViewStatus = autoViewStatus;
global.autoStatusReact = autoStatusReact;
global.welcome = welcome;
global.anticall = anticall;
global.autobio = autobio;
global.prefix = prefix;

// ========== AUTO-RELOAD (imesemplifikishwa – anza upya bot mwenyewe) ==========
// Katika ES modules, hakuna njia rahisi ya kupakia upya faili moja kwa moja.
// Kwa hiyo tunakuonya tu uanze upya bot baada ya kubadilisha config.
const configPath = new URL(import.meta.url).pathname;
fs.watchFile(configPath, () => {
    console.log(color(`⚠️ Config file imebadilika. Tafadhali restart bot ili mabadiliko yaanze kutumika.`, 'yellow'));
});