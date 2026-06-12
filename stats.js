const https = require('https');

const BOT_TOKEN = process.env.STATS_BOT_TOKEN;
const CHAT_ID = '995602630';
const MOSCOW_HOUR = 23;
const MOSCOW_MINUTE = 59;

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

async function getChannelInfo(username) {
  return new Promise((resolve) => {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMemberCount?chat_id=${username}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result || 0);
        } catch {
          resolve(0);
        }
      });
    }).on('error', () => resolve(0));
  });
}

async function getRecentPosts(username) {
  return new Promise((resolve) => {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?chat_id=${username}&limit=100`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const now = Math.floor(Date.now() / 1000);
          const dayStart = now - 86400;
          
          if (!json.result) { resolve(0); return; }
          
          const todayPosts = json.result.filter(update => {
            const msg = update.channel_post || update.message;
            return msg && msg.date >= dayStart;
          });
          
          resolve(todayPosts.length);
        } catch {
          resolve(0);
        }
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
    const posts = await getRecentPosts(channel);
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

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(message)
      }
    };

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

  if (hour === MOSCOW_HOUR && minute === MOSCOW_MINUTE) {
    sendReport();
  }
}

// Проверяем каждую минуту
setInterval(checkAndSend, 60000);
console.log('Stats bot started. Will send report at 23:59 Moscow time.');
