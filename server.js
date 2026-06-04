const express = require('express');
const https = require('https');
const fs = require('fs');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const DB_FILE = '/tmp/products.json';

const CHANNELS = {
  'plgymenshoes':     'Мужская обувь',
  'plgywomanshoes':   'Женская обувь',
  'plgymenclothes':   'Мужская одежда',
  'plgywomenclothes': 'Женская одежда',
  'plgymenbags':      'Сумки',
  'plgyaccessories':  'Аксессуары',
  'plgyjewelry':      'Украшения',
  'plgyposuda':       'Для дома',
};

app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE));
  } catch(e) {}
  return [];
}

function saveDB(products) {
  fs.writeFileSync(DB_FILE, JSON.stringify(products));
}

function parsePost(msg, category) {
  const text = msg.text || msg.caption || '';
  if (!text || text.length < 5) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const name = lines[0].replace(/[^\wа-яёА-ЯЁ\s\-]/gu, '').trim();
  if (!name || name.length < 3) return null;

  const priceMatch = text.match(/(\d[\d\s]{2,})\s*[₽р]/i) ||
                     text.match(/[Сс]тоимость[^\d]*(\d[\d\s]+)/i) ||
                     text.match(/[Цц]ена[^\d]*(\d[\d\s]+)/i);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/\s/g,'')) : null;

  const sizesMatch = text.match(/[Рр]азмер[ыа]?[:\s]*([0-9\/\-,\s]+)/i);
  const sizes = sizesMatch
    ? sizesMatch[1].split(/[\/,]/).map(s=>s.trim()).filter(s=>s.match(/^\d+$/)).slice(0,10)
    : [];

  const photo = msg.photo ? msg.photo[msg.photo.length-1].file_id : null;

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

// Webhook — Telegram sends every new post here
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  const msg = update.channel_post;
  if (!msg || !msg.chat) return;

  const username = msg.chat.username;
  const category = CHANNELS[username];
  if (!category) return;

  const product = parsePost(msg, category);
  if (!product) return;

  const products = loadDB();
  const idx = products.findIndex(p => p.id === product.id);
  if (idx > -1) products[idx] = product;
  else products.unshift(product);

  saveDB(products.slice(0, 2000));
  console.log(`Saved: ${product.name} (${category})`);
});

// Mini App fetches products here
app.get('/products', (req, res) => {
  const products = loadDB();
  res.json({ ok: true, count: products.length, products });
});

// Get photo URL
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
  res.json({ ok: true, products: loadDB().length });
});

app.listen(PORT, () => console.log(`PLGY server on port ${PORT}`));
