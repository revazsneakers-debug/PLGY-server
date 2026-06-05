const express = require('express');
const https = require('https');
const fs = require('fs');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const DB_FILE = '/tmp/products.json';

const CHANNELS = {
  'plgymenshoes':     'РњСѓР¶СЃРєР°СЏ РѕР±СѓРІСЊ',
  'plgywomanshoes':   'Р–РµРЅСЃРєР°СЏ РѕР±СѓРІСЊ',
  'plgymenclothes':   'РњСѓР¶СЃРєР°СЏ РѕРґРµР¶РґР°',
  'plgywomenclothes': 'Р–РµРЅСЃРєР°СЏ РѕРґРµР¶РґР°',
  'plgymenbags':      'РЎСѓРјРєРё',
  'plgyaccessories':  'РђРєСЃРµСЃСЃСѓР°СЂС‹',
  'plgyjewelry':      'РЈРєСЂР°С€РµРЅРёСЏ',
  'plgyposuda':       'Р”Р»СЏ РґРѕРјР°',
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
  try { fs.writeFileSync(DB_FILE, JSON.stringify(products)); } catch(e) {}
}

function parsePost(msg, category) {
  const text = msg.text || msg.caption || '';
  if (!text || text.length < 5) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const name = lines[0].replace(/[рџЏ·пёЏрџ‘џрџ‘ рџ‘њрџ’Ќрџ§Ґрџ‘”рџ©ґрџ“ђрџ’°вњ€пёЏ]/gu, '').trim();
  if (!name || name.length < 2) return null;

  const priceMatch = text.match(/(\d[\d\s]{1,})\s*[в‚ЅСЂ]/i) ||
                     text.match(/[РЎСЃ]С‚РѕРёРјРѕСЃС‚СЊ[^\d]*(\d[\d\s]+)/i) ||
                     text.match(/[Р¦С†]РµРЅР°[^\d]*(\d[\d\s]+)/i);
  const price = priceMatch ? parseInt(priceMatch[1].replace(/\s/g,'')) : null;

  const sizesMatch = text.match(/[Р СЂ]Р°Р·РјРµСЂ[С‹Р°]?[:\s]*([0-9\/\-,\s]+)/i);
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

// Webhook endpoint вЂ” accepts ALL paths with token
app.post('*', (req, res) => {
  res.sendStatus(200);
  const update = req.body;
  console.log('Update received:', JSON.stringify(update).substring(0, 200));

  const msg = update.channel_post;
  if (!msg || !msg.chat) return;

  const username = msg.chat.username;
  const category = CHANNELS[username];
  if (!category) {
    console.log('Unknown channel:', username);
    return;
  }

  const product = parsePost(msg, category);
  if (!product) {
    console.log('Could not parse post');
    return;
  }

  const products = loadDB();
  products.unshift(product);
  saveDB(products.slice(0, 2000));
  console.log(`вњ… Saved: ${product.name} (${category})`);
});

app.get('/products', (req, res) => {
  const products = loadDB();
  res.json({ ok: true, count: products.length, products });
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
  res.json({ ok: true, products: loadDB().length });
});

app.listen(PORT, () => console.log(`PLGY server on port ${PORT}`));
