const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const DB_FILE = '/tmp/products.json';
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

// Temporary storage for forwarded album parts: key = original_message_id
const albumBuffer = {}; // { msgId: { text, caption, photos: [], category, timer } }

app.use(express.json());
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });
app.use('/photos', express.static(PHOTOS_DIR));

function loadDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) {}
  return [];
}
function saveDB(p) { try { fs.writeFileSync(DB_FILE, JSON.stringify(p), 'utf8'); } catch(e) {} }

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
    if (!info.ok) { console.log('getFile failed:', info.description); return null; }
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`;
    const ext = path.extname(info.result.file_path) || '.jpg';
    const filename = Date.now() + '_' + Math.random().toString(36).slice(2) + ext;
    await downloadFile(url, path.join(PHOTOS_DIR, filename));
    console.log('Photo saved:', filename);
    return filename;
  } catch(e) { console.error('Photo error:', e.message); return null; }
}

function parseText(text) {
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
  return { name, price, sizes };
}

async function flushAlbum(key) {
  const buf = albumBuffer[key];
  if (!buf) return;
  clearTimeout(buf.timer);
  delete albumBuffer[key];

  const text = buf.caption || buf.text;
  const parsed = parseText(text);
  if (!parsed) { console.log('Could not parse album text'); return; }

  // Download first photo
  let photoName = null;
  if (buf.photos.length > 0) {
    photoName = await savePhoto(buf.photos[0]);
  }

  const product = {
    id: `fwd_${key}`,
    channel: buf.channel,
    category: buf.category,
    name: parsed.name,
    price: parsed.price,
    sizes: parsed.sizes,
    photo: photoName,
    date: buf.date,
  };

  const products = loadDB();
  const idx = products.findIndex(p => p.id === product.id);
  if (idx > -1) products[idx] = product;
  else products.unshift(product);
  saveDB(products.slice(0, 2000));
  console.log('Saved (forwarded):', product.name, '|', product.price, '|', product.photo || 'no photo');
}

app.post('*', (req, res) => {
  res.sendStatus(200);
  const update = req.body;

  // в”Ђв”Ђ Channel post (no photo expected here for albums, but handle single posts) в”Ђв”Ђ
  const ch = update.channel_post;
  if (ch && ch.chat) {
    const category = CHANNELS[ch.chat.username];
    if (category && !ch.media_group_id) {
      // Single post with photo
      const text = ch.text || ch.caption || '';
      const parsed = parseText(text);
      if (parsed) {
        (async () => {
          let photoName = null;
          if (ch.photo) photoName = await savePhoto(ch.photo[ch.photo.length-1].file_id);
          const product = {
            id: `${ch.chat.username}_${ch.message_id}`,
            channel: ch.chat.username, category,
            ...parsed, photo: photoName, date: ch.date,
          };
          const products = loadDB();
          const idx = products.findIndex(p => p.id === product.id);
          if (idx > -1) products[idx] = product; else products.unshift(product);
          saveDB(products.slice(0, 2000));
          console.log('Saved (channel single):', product.name, '|', product.photo || 'no photo');
        })();
      }
    }
    return;
  }

  // в”Ђв”Ђ Private message to bot (forwarded posts) в”Ђв”Ђ
  const msg = update.message;
  if (!msg) return;

  // Determine source channel from forward_origin or forward_from_chat
  const fwdChat = msg.forward_origin?.chat || msg.forward_from_chat;
  if (!fwdChat) return;

  const username = fwdChat.username;
  const category = CHANNELS[username];
  if (!category) { console.log('Unknown forwarded channel:', username); return; }

  // Use original message id as album key
  const origId = msg.forward_origin?.message_id || msg.forward_from_message_id || msg.message_id;
  const key = `${username}_${origId}`;

  console.log('Forwarded from', username, '| photo:', !!msg.photo, '| caption:', !!(msg.caption||msg.text), '| key:', key);

  if (!albumBuffer[key]) {
    albumBuffer[key] = { channel: username, category, date: msg.date, photos: [], caption: null, text: null };
  }
  const buf = albumBuffer[key];

  if (msg.caption) buf.caption = msg.caption;
  if (msg.text) buf.text = msg.text;
  if (msg.photo) buf.photos.push(msg.photo[msg.photo.length-1].file_id);

  // Reset flush timer
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushAlbum(key), 3000);
});

app.get('/products', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, count: loadDB().length, products: loadDB() }));
});

app.get('/health', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, products: loadDB().length }));
});
const CHANNELS = [
  'plgymenshoes',
  'plgywomanshoes',
  'plgymenclothes',
  'plgywomenclothes',
  'plgymenbags',
  'plgyaccessories',
  'plgyjewelry',
  'plgyposuda'
];

app.post('/bot-webhook', express.json(), async (req, res) => {
      res.sendStatus(200);
      const msg = req.body.message;
      if (!msg || !msg.text) return;
      if (msg.text !== '/report' && msg.text !== '/start') return;

      const chatId = msg.chat.id;
      const STATS_BOT_TOKEN = process.env.STATS_BOT_TOKEN;

      if (msg.text === '/start') {
        const https = require('https');
        const message = JSON.stringify({ chat_id: chatId, text: 'Привет! Напиши /report чтобы получить отчёт по постам за сутки.' });
        const options = { hostname: 'api.telegram.org', path: `/bot${STATS_BOT_TOKEN}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(message) } };
        const r = require('https').request(options, () => {});
        r.write(message); r.end();
        return;
      }

 
app.post('/report-webhook', express.json(), async (req, res) => {
  res.sendStatus(200);
  const msg = req.body.message;
  if (!msg || !msg.text) return;
  if (msg.text !== '/report' && msg.text !== '/start') return;

  const chatId = msg.chat.id;

  function sendTelegramMessage(text) {
    const message = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
    const options = { hostname: 'api.telegram.org', path: `/bot${BOT_TOKEN}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(message) } };
    const r = https.request(options, () => {});
    r.write(message); r.end();
  }

  if (msg.text === '/start') {
    sendTelegramMessage('Привет! Напиши /report чтобы получить отчёт по постам за последние 24 часа.');
    return;
  }

  const products = loadDB();
  const now = Math.floor(Date.now() / 1000);
  const dayStart = now - 86400;

  let totalPosts = 0;
  let report = `📊 *Отчёт за последние 24 часа*\n\n`;

  for (const channelUsername of Object.keys(CHANNELS)) {
    const count = products.filter(p => p.channel === channelUsername && p.date >= dayStart).length;
    totalPosts += count;
    const emoji = count > 0 ? '✅' : '❌';
    report += `${emoji} @${channelUsername}: *${count}* постов\n`;
  }

  report += `\n📦 *Итого: ${totalPosts} постов*`;
  sendTelegramMessage(report);
});
app.listen(PORT, () => console.log('PLGY server on port', PORT));
