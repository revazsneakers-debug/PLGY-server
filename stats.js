const https = require('https');

const BOT_TOKEN = process.env.STATS_BOT_TOKEN;
const CHAT_ID = '995602630';

const CHANNELS = [
  '@plgymenshoes',
  '@plgywomanshoes',
  '@plgymenclothes',
  '@plgywomenclothes',
  '@plgymenbags',
  '@plgyaccessories',
  '@plgyjewelry',
  '@plgyposuda'
];

async function getPostCount(username) {
  return new Promise((resolve) => {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?limit=100`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const now = Math.floor(Date.now() / 1000);
          const dayStart = now - 86400;
          if (!json.result) { resolve(0); return; }
          const todayPosts = json.result.filter(u => {
            const msg = u.channel_post;
            return msg && msg.chat && msg.chat.username === username.replace('@','') && msg.date >= dayStart;
          });
          resolve(todayPosts.length);
        } catch { resolve(0); }
      });
    }).on('error', () => resolve(0));
  });
}

async function sendReport() {
  const today = new Date().toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  let totalPosts = 0;
  let report = `📊 *Отчёт за ${today}*\n\n`;

  for (const channel of CHANNELS) {
    const posts = await getPostCount(channel);
    totalPosts += posts;
    const emoji = posts > 0 ? '✅' : '❌';
    report += `${emoji} ${channel}: *${posts}* постов\n`;
  }

  report += `\n📦 *Итого: ${totalPosts} постов*`;

  const message = JSON.stringify({
    chat_id: CHAT_ID,
    text: report,
    parse_mode: 'Markdown'
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(message)
    }
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', resolve);
    req.write(message);
    req.end();
  });
}

function checkAndSend() {
  const now = new Date();
  const moscowTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const hour = moscowTime.getHours();
  const minute = moscowTime.getMinutes();
  if (hour === 23 && minute === 59) {
    sendReport();
  }
}

setInterval(checkAndSend, 60000);
console.log('Stats bot started. Report will be sent at 23:59 Moscow time.');
