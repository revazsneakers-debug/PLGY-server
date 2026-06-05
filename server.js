const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const DB_FILE = '/tmp/products.json';
const PENDING_FILE = '/tmp/pending.json';
const PHOTOS_DIR = '/tmp/photos';

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR);

const CHANNELS = {
  'plgymenshoes':     '\u041c\u0443\u0436\u0441\u043a\u0430\u044f \u043e\u0431\u0443\u0432\u044c',
  'plgywomanshoes':   '\u0416\u0435\u043d\u0441\u043a\u0430\u044f \u043e\u0431\u0443\u0432\u044c',
  'plgymenclothes':   '\u041c\u0443\u0436\u0441\u043a\u0430\u044f \u043e\u0434\u0435\u0436\u0434\u0430',
  'plgywomenclothes': '\u0416\u0435\u043d\u0441\u043a\u0430\u044f \u043e\u0434\u0435\u0436\u0434\u0430',
  'plgymenbags':      '\u0421\u0443\u043c\u043a\u0438',
  'plgyaccessories':  '\u0410\u043a\u0441\u0435\u0441\u0441\u0443\u0430\u0440\u044b',
  'plgyjewelry':      '\u0423\u043a\u0440\u0430\u0448\u0435\u043d\u0438\u044f',
  'plgyposuda':       '\u0414\u043b\u044f \u0434\u043e\u043c\u0430',
};

const timers = {};

app.use(express.json());
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });
app.use('/photos', express.static(PHOTOS_DIR));

function loadDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) {}
  return [];
}
function saveDB(p) { try { fs.writeFileSync(DB_FILE, JSON.stringify(p), 'utf8'); } catch(e) {} }
function loadPending() {
  try { if (fs.existsSync(PENDING_FILE)) return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); } catch(e) {}
  return {};
}
function savePending(p) { try { fs.writeFileSync(PENDING_FILE, JSON.stringify(p), 'utf8'); } catch(e) {} }

function tgGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, r => {
      r.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', e => { fs.unlink(dest, ()=>{}); reject(e); });
  });
}

async function savePhoto(fileId) {
  try {
    const info = await tgGet(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    if (!info.ok) { console.log('getFile failed:', JSON.stringify(info)); return null; }
    const tgUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`;
    const ext = path.extname(info.result.file_path) || '.jpg';
    const filename = Date.now() + ext;
    const dest = path.join(PHOTOS_DIR, filename);
    await downloadFile(tgUrl, dest);
    console.log('Photo saved:', filename);
    return filename;
  } catch(e) {
    console.error('Photo error:', e.message);
    return null;
  }
}

function parseText(text, channel, date, msgId) {
  if (!text || text.length < 3) return null;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const name = lines[0].replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();
  if (!name || name.length < 2) return null;

  let price = null;
  for (const line of lines) {
    const m = line.match(/(?:\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c|\u0426\u0435\u043d\u0430)[:\s\-]+(\d[\d\s]*)\s*[\u20bd\u0440]/iu);
    if (m) { price = parseInt(m[1].replace(/\s/g, '')); break; }
  }

  let sizes = [];
  for (const line of lines) {
    const m = line.match(/\u0420\u0430\u0437\u043c\u0435\u0440[:\s]+([A-Za-z0-9][A-Za-z0-9\/\-,\s]+)/iu);
    if (m) { sizes = m[1].split(/[\-\/,]/).map(s=>s.trim()).filter(s=>s.length>0).slice(0,10); break; }
  }

  return { name, price, sizes, id: `${channel}_${msgId}`, channel, date };
}

async function flushGroup(groupId) {
  if (timers[groupId]) { clearTimeout(timers[groupId]); delete timers[groupId]; }
  const pending = loadPending();
  const msgs = pending[groupId];
  if (!msgs || !msgs.length) return;
  delete pending[groupId];
  savePending(pending);

  console.log(`Flushing group ${groupId}, ${msgs.length} messages`);

  // Find message with caption (product info)
  const captionMsg = msgs.find(m => m.caption);
  // Find any message with photo
  const photoMsg = msgs.find(m => m.photo);

  if (!captionMsg) { console.log('No caption in group'); return; }

  const category = CHANNELS[captionMsg.chat.username];
  if (!category) return;

  const parsed = parseText(captionMsg.caption, captionMsg.chat.username, captionMsg.date, captionMsg.message_id);
  if (!parsed) return;

  // Get photo from caption message or any other in group
  const bestPhotoMsg = captionMsg.photo ? captionMsg : photoMsg;
  let photoName = null;
  if (bestPhotoMsg && bestPhotoMsg.photo) {
    const fileId = bestPhotoMsg.photo[bestPhotoMsg.photo.length - 1].file_id;
    console.log('Downloading photo, fileId:', fileId.substring(0, 20) + '...');
    photoName = await savePhoto(fileId);
  }

  const product = { ...parsed, category, photo: photoName };
  const products = loadDB();
  const idx = products.findIndex(p => p.id === product.id);
  if (idx > -1) products[idx] = product;
  else products.unshift(product);
  saveDB(products.slice(0, 2000));
  console.log('Saved:', product.name, '|', product.price, '|', product.photo || 'no photo');
}

async function processSingle(msg, category) {
  const text = msg.text || msg.caption || '';
  const parsed = parseText(text, msg.chat.username, msg.date, msg.message_id);
  if (!parsed) return;

  let photoName = null;
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    photoName = await savePhoto(fileId);
  }

  const product = { ...parsed, category, photo: photoName };
  const products = loadDB();
  const idx = products.findIndex(p => p.id === product.id);
  if (idx > -1) products[idx] = product;
  else products.unshift(product);
  saveDB(products.slice(0, 2000));
  console.log('Saved:', product.name, '|', product.price, '|', product.photo || 'no photo');
}

app.post('*', (req, res) => {
  res.sendStatus(200);
  const msg = req.body.channel_post;
  if (!msg || !msg.chat) return;

  const category = CHANNELS[msg.chat.username];
  if (!category) return;

  console.log('Got post from', msg.chat.username, '| has photo:', !!msg.photo, '| has caption:', !!msg.caption, '| group:', msg.media_group_id || 'none');

  if (msg.media_group_id) {
    const pending = loadPending();
    if (!pending[msg.media_group_id]) pending[msg.media_group_id] = [];
    pending[msg.media_group_id].push(msg);
    savePending(pending);

    // Reset timer on each new message in group вЂ” flush 4s after last message
    if (timers[msg.media_group_id]) clearTimeout(timers[msg.media_group_id]);
    timers[msg.media_group_id] = setTimeout(() => flushGroup(msg.media_group_id), 4000);
    return;
  }

  processSingle(msg, category);
});

app.get('/products', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, count: loadDB().length, products: loadDB() }));
});

app.get('/health', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, products: loadDB().length }));
});

app.listen(PORT, () => console.log('PLGY server on port', PORT));
