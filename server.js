const express = require('express');
const https = require('https');
const fs = require('fs');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const DB_FILE = '/tmp/products.json';

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

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) {}
  return [];
}

function saveDB(products) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(products), 'utf8'); } catch(e) {}
}

function parsePost(msg, category) {
  const text = (msg.text || msg.caption || '').trim();
  if (!text || text.length < 3) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const name = lines[0].replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();
  if (!name || name.length < 2) return null;

  // Find price line specifically вЂ” must contain keyword
  let price = null;
  for (const line of lines) {
    const m = line.match(/(?:\u0421\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c|\u0426\u0435\u043d\u0430)[:\s\-]+(\d[\d\s]*)\s*[\u20bd\u0440]/iu);
    if (m) { price = parseInt(m[1].replace(/\s/g, '')); break; }
  }

  // Sizes вЂ” handle dash-separated like 50-52-54-56
  let sizes = [];
  for (const line of lines) {
    const m = line.match(/\u0420\u0430\u0437\u043c\u0435\u0440[:\s]+([0-9][\d\-\/,\s]+)/iu);
    if (m) {
      sizes = m[1].split(/[\-\/,]/).map(s => s.trim()).filter(s => /^\d+$/.test(s)).slice(0, 10);
      break;
    }
  }

  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;

  return {
    id: `${msg.chat.username}_${msg.message_id}`,
    channel: msg.chat.username,
    category,
    name,
    price,
    sizes,
    photo,
    date: msg.date,
  };
}

app.post('*', (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  const msg = update.channel_post;
  if (!msg || !msg.chat) return;

  const username = msg.chat.username;
  const category = CHANNELS[username];
  if (!category) return;

  // Skip service messages
  if (!msg.text && !msg.caption && !msg.photo) return;

  const product = parsePost(msg, category);
  if (!product) return;

  const products = loadDB();
  const idx = products.findIndex(p => p.id === product.id);
  if (idx > -1) products[idx] = product;
  else products.unshift(product);
  saveDB(products.slice(0, 2000));
  console.log('Saved:', product.name, '|', product.price, '|', product.sizes.join(','));
});

app.get('/products', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const products = loadDB();
  res.end(JSON.stringify({ ok: true, count: products.length, products }));
});

app.get('/photo/:file_id', (req, res) => {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${req.params.file_id}`;
  https.get(url, r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => {
      try {
        const f = JSON.parse(d);
        if (f.ok) res.redirect(`https://api.telegram.org/file/bot${BOT_TOKEN}/${f.result.file_path}`);
        else res.status(404).send('Not found');
      } catch(e) { res.status(500).send('Error'); }
    });
  });
});

app.get('/health', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, products: loadDB().length }));
});

app.listen(PORT, () => console.log('PLGY server on port', PORT));
