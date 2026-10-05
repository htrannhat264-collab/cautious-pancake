// ================== LỆNH MỚI: /engines ==================
bot.onText(/\/engines/, (msg) => {
  const chatId = msg.chat.id;
  for (const gameKey of Object.keys(GAMES)) {
    const mem = memory[gameKey];
    const arr = ENGINES.map(e => ({
      name: e.name,
      w: mem.engineWeights.get(e.name) ?? e.defaultWeight,
      stats: mem.engineStats.get(e.name) || { hits: 0, total: 0, acc: 0 },
    })).sort((a, b) => b.w - a.w);

    let text = `⚙️ *12 ENGINES — ${GAMES[gameKey].name}*\n━━━━━━━━━━━━━━━━━━\n`;
    for (const e of arr) {
      const accStr = e.stats.total > 0
        ? (e.stats.hits / e.stats.total * 100).toFixed(1) + '%'
        : '—';
      const mark = e.w >= 1.5 ? '🟢' : e.w >= 1.0 ? '🟡' : '🔴';
      text += `${mark} \`${e.name.padEnd(10)}\` W:*${e.w.toFixed(2)}* Acc:*${accStr}* (${e.stats.hits}/${e.stats.total})\n`;
    }
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  }
});

// Thêm vào MENU keyboard
const MENU_V3 = {
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

// Cập nhật lại handler menu (đặt SAU handler cũ để ghi đè)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  try {
    if (text === '⚙️ Engines Tài Xỉu' || text === '⚙️ Engines MD5') {
      const gameKey = text.includes('MD5') ? 'md5' : 'taixiu';
      const mem = memory[gameKey];
      const arr = ENGINES.map(e => ({
        name: e.name,
        w: mem.engineWeights.get(e.name) ?? e.defaultWeight,
        stats: mem.engineStats.get(e.name) || { hits: 0, total: 0 },
      })).sort((a, b) => b.w - a.w);

      let str = `⚙️ *12 ENGINES — ${GAMES[gameKey].name}*\n━━━━━━━━━━━━━━━━━━\n`;
      for (const e of arr) {
        const accStr = e.stats.total > 0
          ? (e.stats.hits / e.stats.total * 100).toFixed(1) + '%'
          : '—';
        const mark = e.w >= 1.5 ? '🟢' : e.w >= 1.0 ? '🟡' : '🔴';
        str += `${mark} \`${e.name.padEnd(10)}\` W:*${e.w.toFixed(2)}* Acc:*${accStr}*\n`;
      }
      bot.sendMessage(chatId, str, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Lỗi: ${e.message}`);
  }
});
