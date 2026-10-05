// bot.js — Telegram Bot với TOKEN MỚI
import TelegramBot from 'node-telegram-bot-api';
import { getPrediction, memory, GAMES, sideName, ENGINES } from './server.js';

// ================== TOKEN MỚI ==================
const TOKEN = '8081809059:AAE_6DrVDDGAUmfdssENGvgOAFolhpyI-Go';
const bot = new TelegramBot(TOKEN, { polling: true });

console.log('🤖 Bot đang chạy...');

// ================== MENU ==================
const MENU = {
  reply_markup: {
    keyboard: [
      [{ text: '🎲 Dự đoán Tài Xỉu' }, { text: '🔐 Dự đoán MD5' }],
      [{ text: '📜 Lịch sử Tài Xỉu' }, { text: '📜 Lịch sử MD5' }],
      [{ text: '🧠 Học cầu Tài Xỉu' }, { text: '🧠 Học cầu MD5' }],
      [{ text: '⚙️ Engines Tài Xỉu' }, { text: '⚙️ Engines MD5' }],
      [{ text: '📊 Thống kê tổng' }],
    ],
    resize_keyboard: true,
  },
};

// ================== HELPERS ==================
const sideEmoji = (s) => s === 'T' ? '🔴' : '🔵';

function predictMessage(data) {
  const emoji = sideEmoji(data.predictSide);
  return `🎯 *${data.game.toUpperCase()}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📊 Phiên hiện tại: *${data.session}*\n` +
    `🎲 Xúc xắc: ${data.lastDice.join(' - ')} = *${data.lastSum}*\n` +
    `📌 Kết quả: ${sideEmoji(data.lastResult)} *${data.lastResultName}*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🔮 PHIÊN DỰ ĐOÁN: *${data.nextSession}*\n` +
    `${emoji} DỰ ĐOÁN: *${data.predict.toUpperCase()}*\n` +
    `🎯 Tỉ lệ: *${data.confidence}%*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🏆 Thắng: *${data.stats.win}* | 💥 Thua: *${data.stats.lose}*`;
}

function historyMessage(gameKey) {
  const mem = memory[gameKey];
  const name = GAMES[gameKey].name;
  const hist = mem.history.slice(0, 30);
  if (hist.length === 0) return `📜 *LỊCH SỬ ${name.toUpperCase()}*\n\n_Chưa có dự đoán nào._`;

  let text = `📜 *LỊCH SỬ DỰ ĐOÁN — ${name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━\n`;
  const total = mem.stats.win + mem.stats.lose;
  const acc = total > 0 ? (mem.stats.win / total * 100).toFixed(1) : '0.0';
  text += `🏆 *${mem.stats.win}*  💥 *${mem.stats.lose}*  📈 *${acc}%*\n━━━━━━━━━━━━━━━━━━\n\n`;

  for (const h of hist) {
    let line = `#${h.session} ${sideEmoji(h.predictSide)} ${h.predictName}`;
    if (h.actual) line += ` → ${sideEmoji(h.actual)} ${h.actualName} ${h.correct ? '✅' : '❌'}`;
    else line += ` ⏳`;
    text += line + '\n';
  }
  return text;
}

function learnMessage(gameKey) {
  const mem = memory[gameKey];
  const name = GAMES[gameKey].name;
  const patterns = Array.from(mem.patterns.entries())
    .map(([key, v]) => ({
      pattern: key, correct: v.correct, wrong: v.wrong,
      total: v.correct + v.wrong,
      acc: v.correct + v.wrong > 0 ? (v.correct / (v.correct + v.wrong) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total).slice(0, 15);

  let text = `🧠 *HỌC CẦU — ${name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━\n`;
  text += `📚 Patterns đã học: *${mem.patterns.size}*\n`;
  const total = mem.stats.win + mem.stats.lose;
  const acc = total > 0 ? (mem.stats.win / total * 100).toFixed(1) : '0.0';
  text += `🏆 *${mem.stats.win}* | 💥 *${mem.stats.lose}* | 📈 *${acc}%*\n━━━━━━━━━━━━━━━━━━\n\n`;
  text += `🔝 *Top 15 pattern mạnh:*\n\n`;

  if (patterns.length === 0) text += `_Chưa học được pattern nào._`;
  else for (const p of patterns) {
    const mark = p.acc >= 60 ? '🟢' : p.acc >= 40 ? '🟡' : '🔴';
    text += `${mark} \`${p.pattern}\`\n   ✔️${p.correct} ✖️${p.wrong} 📊${p.acc.toFixed(1)}%\n`;
  }
  return text;
}

function enginesMessage(gameKey) {
  const mem = memory[gameKey];
  const arr = ENGINES.map(e => ({
    name: e.name,
    w: mem.engineWeights.get(e.name) ?? e.defaultWeight,
    stats: mem.engineStats.get(e.name) || { hits: 0, total: 0 },
  })).sort((a, b) => b.w - a.w);

  let text = `⚙️ *12 ENGINES — ${GAMES[gameKey].name}*\n━━━━━━━━━━━━━━━━━━\n`;
  for (const e of arr) {
    const accStr = e.stats.total > 0
      ? (e.stats.hits / e.stats.total * 100).toFixed(1) + '%' : '—';
    const mark = e.w >= 1.5 ? '🟢' : e.w >= 1.0 ? '🟡' : '🔴';
    text += `${mark} \`${e.name.padEnd(10)}\` W:*${e.w.toFixed(2)}* Acc:*${accStr}* (${e.stats.hits}/${e.stats.total})\n`;
  }
  return text;
}

function statsMessage() {
  let text = `📊 *THỐNG KÊ TỔNG*\n━━━━━━━━━━━━━━━━━━\n\n`;
  for (const k of Object.keys(GAMES)) {
    const mem = memory[k];
    const total = mem.stats.win + mem.stats.lose;
    const acc = total > 0 ? (mem.stats.win / total * 100).toFixed(1) : '0.0';
    text += `🎮 *${GAMES[k].name}*\n`;
    text += `   🏆${mem.stats.win} 💥${mem.stats.lose} 📈${acc}% 🧠${mem.patterns.size}p\n\n`;
  }
  return text;
}

// ================== COMMANDS ==================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🎲 *Chào mừng đến với AI Dự Đoán Tài Xỉu!*\n\n` +
    `Bot có thể:\n` +
    `• 🔮 Dự đoán Tài/Xỉu cho cả 2 bàn\n` +
    `• 📜 Xem lịch sử dự đoán đúng/sai\n` +
    `• 🧠 Xem trạng thái học cầu\n` +
    `• ⚙️ Xem 12 engines AI\n` +
    `• 📊 Thống kê tổng hợp\n\n` +
    `*Lệnh:*\n` +
    `/predict - Dự đoán cả 2 bàn\n` +
    `/history - Lịch sử\n` +
    `/learn - Học cầu\n` +
    `/engines - Trạng thái engines\n` +
    `/stats - Thống kê\n` +
    `/subscribe - Bật thông báo tự động\n` +
    `/unsubscribe - Tắt thông báo`,
    { parse_mode: 'Markdown', ...MENU }
  );
});

bot.onText(/\/predict/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const [tx, md5] = await Promise.all([getPrediction('taixiu'), getPrediction('md5')]);
    await bot.sendMessage(chatId, predictMessage(tx), { parse_mode: 'Markdown' });
    await bot.sendMessage(chatId, predictMessage(md5), { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `❌ Lỗi: ${e.message}`);
  }
});

bot.onText(/\/history/, (msg) => {
  bot.sendMessage(msg.chat.id, historyMessage('taixiu'), { parse_mode: 'Markdown' });
  bot.sendMessage(msg.chat.id, historyMessage('md5'), { parse_mode: 'Markdown' });
});

bot.onText(/\/learn/, (msg) => {
  bot.sendMessage(msg.chat.id, learnMessage('taixiu'), { parse_mode: 'Markdown' });
  bot.sendMessage(msg.chat.id, learnMessage('md5'), { parse_mode: 'Markdown' });
});

bot.onText(/\/engines/, (msg) => {
  bot.sendMessage(msg.chat.id, enginesMessage('taixiu'), { parse_mode: 'Markdown' });
  bot.sendMessage(msg.chat.id, enginesMessage('md5'), { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, (msg) => {
  bot.sendMessage(msg.chat.id, statsMessage(), { parse_mode: 'Markdown' });
});

// ================== MENU HANDLER ==================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  try {
    if (text === '🎲 Dự đoán Tài Xỉu') {
      const data = await getPrediction('taixiu');
      bot.sendMessage(chatId, predictMessage(data), { parse_mode: 'Markdown' });
    } else if (text === '🔐 Dự đoán MD5') {
      const data = await getPrediction('md5');
      bot.sendMessage(chatId, predictMessage(data), { parse_mode: 'Markdown' });
    } else if (text === '📜 Lịch sử Tài Xỉu') {
      bot.sendMessage(chatId, historyMessage('taixiu'), { parse_mode: 'Markdown' });
    } else if (text === '📜 Lịch sử MD5') {
      bot.sendMessage(chatId, historyMessage('md5'), { parse_mode: 'Markdown' });
    } else if (text === '🧠 Học cầu Tài Xỉu') {
      bot.sendMessage(chatId, learnMessage('taixiu'), { parse_mode: 'Markdown' });
    } else if (text === '🧠 Học cầu MD5') {
      bot.sendMessage(chatId, learnMessage('md5'), { parse_mode: 'Markdown' });
    } else if (text === '⚙️ Engines Tài Xỉu') {
      bot.sendMessage(chatId, enginesMessage('taixiu'), { parse_mode: 'Markdown' });
    } else if (text === '⚙️ Engines MD5') {
      bot.sendMessage(chatId, enginesMessage('md5'), { parse_mode: 'Markdown' });
    } else if (text === '📊 Thống kê tổng') {
      bot.sendMessage(chatId, statsMessage(), { parse_mode: 'Markdown' });
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Lỗi: ${e.message}`);
  }
});

// ================== SUBSCRIBE ==================
const subscribers = new Set();
let lastNotified = { taixiu: 0, md5: 0 };

bot.onText(/\/subscribe/, (msg) => {
  subscribers.add(msg.chat.id);
  bot.sendMessage(msg.chat.id, '✅ Đã đăng ký nhận thông báo tự động!');
});
bot.onText(/\/unsubscribe/, (msg) => {
  subscribers.delete(msg.chat.id);
  bot.sendMessage(msg.chat.id, '❌ Đã hủy đăng ký.');
});

setInterval(async () => {
  if (subscribers.size === 0) return;
  for (const gameKey of Object.keys(GAMES)) {
    try {
      const data = await getPrediction(gameKey);
      if (data.nextSession !== lastNotified[gameKey]) {
        lastNotified[gameKey] = data.nextSession;
        const message = `🔔 *PHIÊN MỚI!*\n\n${predictMessage(data)}`;
        for (const chatId of subscribers) {
          bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(() => {});
        }
      }
    } catch (e) { /* ignore */ }
  }
}, 60000);

console.log('✅ Bot sẵn sàng. Nhấn Ctrl+C để thoát.');
