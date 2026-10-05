// server.js — VIP 9.0: Anti-bias, nhận diện cầu riêng từng game
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// ================== CẤU HÌNH GAME ==================
const GAMES = {
  taixiu: {
    name: 'Tài Xỉu',
    api: 'https://taixiu.maksh3979madfw.com/api/luckydice/GetSoiCau',
    profile: {
      nhipBiet: [1.5, 2.2, 3.0],
      doDaiBet: [2, 3, 4, 5],
      uuTienCau: ['cauCoDien', 'streak', 'markov', 'cauPhucTap'],
      heSoBias: 0.25,
      nguongBetDai: 5,
    },
  },
  md5: {
    name: 'Tài Xỉu MD5',
    api: 'https://taixiumd5.maksh3979madfw.com/api/md5luckydice/GetSoiCau',
    profile: {
      nhipBiet: [1.2, 1.8, 2.5],
      doDaiBet: [1, 2, 3, 4],
      uuTienCau: ['cauPhucTap', 'cauCoDien', 'ngram', 'markov'],
      heSoBias: 0.4,
      nguongBetDai: 4,
    },
  },
};

// ================== BỘ NHỚ ==================
const memory = {
  taixiu: {
    patterns: new Map(),
    engines: new Map(),
    history: [],
    stats: { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 },
    lastPredictions: [],
  },
  md5: {
    patterns: new Map(),
    engines: new Map(),
    history: [],
    stats: { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 },
    lastPredictions: [],
  },
};

// ================== PERSIST ==================
const DATA_FILE = path.join(__dirname, 'data.json');

function saveMemory() {
  const obj = {};
  for (const k of Object.keys(memory)) {
    obj[k] = {
      patterns: Array.from(memory[k].patterns.entries()),
      engines: Array.from(memory[k].engines.entries()),
      history: memory[k].history.slice(0, 500),
      stats: memory[k].stats,
      lastPredictions: memory[k].lastPredictions.slice(0, 30),
    };
  }
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2)); } catch (e) {}
}

function loadMemory() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const obj = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const k of Object.keys(obj)) {
      if (!memory[k]) continue;
      memory[k].patterns = new Map(obj[k].patterns || []);
      memory[k].engines = new Map(obj[k].engines || []);
      memory[k].history = obj[k].history || [];
      memory[k].stats = obj[k].stats || { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 };
      memory[k].lastPredictions = obj[k].lastPredictions || [];
    }
    console.log('✅ Đã tải bộ nhớ VIP 9.0');
  } catch (e) { console.error('Lỗi load:', e.message); }
}
loadMemory();

// ================== HELPERS ==================
const toResult = (s) => s.BetSide === 1 ? 'X' : 'T';
const sideName = (r) => r === 'T' ? 'Tài' : 'Xỉu';
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const toSeries = (list) => list.map(toResult);
const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

// =====================================================================
//        50+ LOẠI CẦU — NHẬN DIỆN ĐẦY ĐỦ
// =====================================================================
function detectAllPatterns(series) {
  const s = series.slice(0, 100);
  const n = s.length;
  const joined = s.join('');
  const feats = {};

  // ===== CẤP 1: VI MÔ =====
  let streak = 1;
  for (let i = 1; i < n; i++) {
    if (s[i] === s[0]) streak++; else break;
  }
  feats.streak = streak;
  feats.streakSide = s[0];

  let runs = [], cur = 1;
  for (let i = 1; i < n; i++) {
    if (s[i] === s[i - 1]) cur++;
    else { runs.push(cur); cur = 1; }
  }
  runs.push(cur);
  feats.runs = runs;
  feats.avgRun = runs.reduce((a, b) => a + b, 0) / runs.length;
  feats.maxRun = Math.max(...runs);
  feats.minRun = Math.min(...runs);
  feats.stdRun = Math.sqrt(runs.reduce((a, b) => a + (b - feats.avgRun) ** 2, 0) / runs.length);
  feats.medianRun = [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)];

  // ===== CẤP 2: TRUNG MÔ — 25+ loại cầu =====
  feats.cau11 = /(TX|XT){4,}/.test(joined);
  feats.cau11_strong = /(TX|XT){6,}/.test(joined);
  feats.cau11_super = /(TX|XT){10,}/.test(joined);
  feats.cau22 = /(TTXX|XXTT){2,}/.test(joined);
  feats.cau22_strong = /(TTXX|XXTT){3,}/.test(joined);
  feats.cau22_super = /(TTXX|XXTT){4,}/.test(joined);
  feats.cau33 = /(TTTXXX|XXXTTT){2,}/.test(joined);
  feats.cau44 = /(TTTTXXXX|XXXXTTTT)/.test(joined);
  feats.cau121 = /TXXT|XTTX/.test(joined);
  feats.cau212 = /TTXXTT|XXTTXX/.test(joined);
  feats.cau1221 = /TXXTTXXT|XTTXXTTX/.test(joined);
  feats.cau323 = /TTTXXTTT|XXXTTXXX/.test(joined);
  feats.cau232 = /TTXXXTT|XXTTTXX/.test(joined);
  feats.cau424 = /TTTTXXTTTT|XXXXTTXXXX/.test(joined);
  feats.betDai3 = /(TTT|XXX)/.test(joined);
  feats.betDai5 = /(TTTTT|XXXXX)/.test(joined);
  feats.betDai7 = /(TTTTTTT|XXXXXXX)/.test(joined);
  feats.betDai9 = /(TTTTTTTTT|XXXXXXXXX)/.test(joined);
  feats.cauGay1 = /(TTX|XXT)/.test(joined);
  feats.cauGay2 = /(TTXXT|XXTTX)/.test(joined);
  feats.cauBacThang = /(TX|XT)(TTXX|XXTT)(TTTXXX|XXXTTT)/.test(joined);
  feats.cauHinhSin = /(TTXXTT|XXTTXX|TTXXXTT)/.test(joined);

  const countT = s.filter(x => x === 'T').length;
  const countX = n - countT;
  feats.tyLeT = countT / n;
  feats.tyLeX = countX / n;
  feats.nghiengT = feats.tyLeT > 0.65;
  feats.nghiengX = feats.tyLeX > 0.65;
  feats.nghiengCuc = feats.tyLeT > 0.75 || feats.tyLeX > 0.75;

  // ===== CẤP 3: VĨ MÔ =====
  const pT = feats.tyLeT, pX = feats.tyLeX;
  feats.entropy = -(pT * Math.log2(pT || 0.0001) + pX * Math.log2(pX || 0.0001));

  let cycleT = [], lastT = -1;
  for (let i = 0; i < n; i++) {
    if (s[i] === 'T') {
      if (lastT !== -1) cycleT.push(i - lastT);
      lastT = i;
    }
  }
  feats.chuKyT = cycleT.length > 0 ? cycleT.reduce((a, b) => a + b, 0) / cycleT.length : 2;
  feats.stdChuKyT = cycleT.length > 1
    ? Math.sqrt(cycleT.reduce((a, b) => a + (b - feats.chuKyT) ** 2, 0) / cycleT.length) : 0;

  let cycleX = [], lastX = -1;
  for (let i = 0; i < n; i++) {
    if (s[i] === 'X') {
      if (lastX !== -1) cycleX.push(i - lastX);
      lastX = i;
    }
  }
  feats.chuKyX = cycleX.length > 0 ? cycleX.reduce((a, b) => a + b, 0) / cycleX.length : 2;

  feats.gapT = s.indexOf('T');
  feats.gapX = s.indexOf('X');
  if (feats.gapT === -1) feats.gapT = 99;
  if (feats.gapX === -1) feats.gapX = 99;

  const g1 = s.slice(0, 15), g2 = s.slice(15, 30), g3 = s.slice(30, 45);
  feats.g1T = g1.filter(x => x === 'T').length / 15;
  feats.g2T = g2.filter(x => x === 'T').length / 15;
  feats.g3T = g3.filter(x => x === 'T').length / 15;
  feats.trendUp = feats.g1T > feats.g2T && feats.g2T > feats.g3T;
  feats.trendDown = feats.g1T < feats.g2T && feats.g2T < feats.g3T;

  // ===== CẤP 4: MARKOV + N-GRAM =====
  for (let k = 1; k <= 15; k++) {
    const key = s.slice(0, k).join('');
    let t = 0, x = 0;
    for (let i = k; i < n; i++) {
      if (s.slice(i - k, i).join('') === key) {
        if (s[i] === 'T') t++; else x++;
      }
    }
    feats[`mk${k}`] = { key, t, x, total: t + x };
  }
  for (let ng = 2; ng <= 12; ng++) {
    const key = s.slice(0, ng).join('');
    let t = 0, x = 0;
    for (let i = ng; i < n; i++) {
      if (s.slice(i - ng, i).join('') === key) {
        if (s[i] === 'T') t++; else x++;
      }
    }
    feats[`ngram${ng}`] = { key, t, x, total: t + x };
  }

  // ===== CẤP 5: ĐỐI XỨNG + FIBONACCI + MOMENTUM =====
  for (let len = 4; len <= 14; len += 2) {
    const palin = s.slice(0, len).join('');
    feats[`doiXung${len}`] = palin === palin.split('').reverse().join('');
  }

  const half = Math.floor(n / 2);
  const fh = s.slice(0, half).join('');
  const sh = s.slice(half, half * 2).join('');
  let same = 0;
  for (let i = 0; i < Math.min(fh.length, sh.length); i++) if (fh[i] === sh[i]) same++;
  feats.doiXungScore = same / Math.min(fh.length, sh.length);

  const fibs = [1, 2, 3, 5, 8, 13, 21, 34, 55];
  let fibT = 0, fibX = 0;
  for (const f of fibs) { if (s[f] === 'T') fibT++; else if (s[f] === 'X') fibX++; }
  feats.fibT = fibT;
  feats.fibX = fibX;

  const r10 = s.slice(0, 10), o10 = s.slice(10, 20);
  feats.momentumT = (r10.filter(x => x === 'T').length / 10) -
                    (o10.filter(x => x === 'T').length / 10);

  let alt = 0;
  for (let i = 1; i < n; i++) if (s[i] !== s[i - 1]) alt++;
  feats.altRatio = alt / (n - 1);
  feats.alternating = feats.altRatio > 0.65;

  let rev = 0;
  for (let i = 1; i < n - 1; i++) {
    if (s[i] !== s[i - 1] && s[i] !== s[i + 1]) rev++;
  }
  feats.reversalRate = n > 2 ? rev / (n - 2) : 0;

  return feats;
}

// =====================================================================
//       20 ENGINES
// =====================================================================
function engineMarkov(f) {
  let sT = 0, sX = 0;
  for (let k = 1; k <= 15; k++) {
    const m = f[`mk${k}`];
    if (!m || m.total < 2) continue;
    const w = Math.pow(1.4, 15 - k) * (m.total / (m.total + 3));
    sT += ((m.t + 1) / (m.total + 2)) * w;
    sX += ((m.x + 1) / (m.total + 2)) * w;
  }
  return { T: sT, X: sX };
}

function engineStreak(f) {
  const score = { T: 0, X: 0 };
  const side = f.streakSide;
  const opp = side === 'T' ? 'X' : 'T';
  const st = f.streak, avg = f.avgRun, std = f.stdRun;
  if (st > avg + std) score[opp] += 1.2 + (st - avg) * 0.4;
  else if (st < avg - std && st < 2) score[side] += 0.6;
  if (st >= 5) score[opp] += 0.8;
  if (st >= 7) score[opp] += 1.2;
  if (st >= 9) score[opp] += 1.5;
  if (st >= f.maxRun && st >= 4) score[opp] += 0.7;
  if (st === f.medianRun && st >= 2) score[opp] += 0.3;
  return score;
}

function engineFrequency(f) {
  const score = { T: 0, X: 0 };
  const devT = f.tyLeT - 0.5;
  score.T -= devT * 2.2;
  score.X += devT * 2.2;
  if (f.tyLeT > 0.7) score.X += 1.5;
  if (f.tyLeX > 0.7) score.T += 1.5;
  if (f.gapT >= 5) score.T += f.gapT * 0.12;
  if (f.gapX >= 5) score.X += f.gapX * 0.12;
  return score;
}

function engineCauCoDien(f, series) {
  const score = { T: 0, X: 0 };
  const s = series.slice(0, 20).join('');
  if (f.cau11_super) score[series[0] === 'T' ? 'X' : 'T'] += 2.5;
  else if (f.cau11_strong) score[series[0] === 'T' ? 'X' : 'T'] += 2.0;
  else if (f.cau11) score[series[0] === 'T' ? 'X' : 'T'] += 1.2;

  if (f.cau22_super) score[series[0] === 'T' ? 'X' : 'T'] += 1.8;
  else if (f.cau22_strong) {
    if (/(TTTT|XXXX)$/.test(s)) score[series[0] === 'T' ? 'X' : 'T'] += 1.3;
    else score[series[0] === 'T' ? 'X' : 'T'] += 0.8;
  }

  if (f.cau33 && /(TTTTTT|XXXXXX)$/.test(s)) score[series[0] === 'T' ? 'X' : 'T'] += 1.2;
  if (f.cau44) score[series[0] === 'T' ? 'X' : 'T'] += 1.5;
  if (f.betDai9) score[series[0] === 'T' ? 'X' : 'T'] += 2.0;
  else if (f.betDai7) score[series[0] === 'T' ? 'X' : 'T'] += 1.5;
  else if (f.betDai5) score[series[0] === 'T' ? 'X' : 'T'] += 0.8;

  return score;
}

function engineCauPhucTap(f, series) {
  const score = { T: 0, X: 0 };
  const s = series.slice(0, 12).join('');
  if (f.cau121) {
    if (s.startsWith('TXXT')) score.X += 1.0;
    if (s.startsWith('XTTX')) score.T += 1.0;
  }
  if (f.cau212) {
    if (s.startsWith('TTXXTT')) score.X += 0.9;
    if (s.startsWith('XXTTXX')) score.T += 0.9;
  }
  if (f.cau1221) {
    if (s.startsWith('TXXTTXXT')) score.T += 1.2;
    if (s.startsWith('XTTXXTTX')) score.X += 1.2;
  }
  if (f.cau323) {
    if (s.startsWith('TTTXXTTT')) score.T += 1.1;
    if (s.startsWith('XXXTTXXX')) score.X += 1.1;
  }
  if (f.cau232) {
    if (s.startsWith('TTXXXTT')) score.T += 1.0;
    if (s.startsWith('XXTTTXX')) score.X += 1.0;
  }
  if (f.cau424) {
    if (s.startsWith('TTTTXXTTTT')) score.T += 1.5;
    if (s.startsWith('XXXXTTXXXX')) score.X += 1.5;
  }
  return score;
}

function engineNGram(f) {
  let sT = 0, sX = 0;
  for (let ng = 2; ng <= 12; ng++) {
    const g = f[`ngram${ng}`];
    if (!g || g.total < 2) continue;
    const w = Math.pow(1.5, ng - 2) * (g.total / (g.total + 3));
    sT += ((g.t + 1) / (g.total + 2)) * w;
    sX += ((g.x + 1) / (g.total + 2)) * w;
  }
  return { T: sT, X: sX };
}

function engineBayesian(f) {
  let pT = 0.5, pX = 0.5;
  const m4 = f.mk4, m6 = f.mk6, m8 = f.mk8;
  if (m4 && m4.total >= 3) {
    pT *= ((m4.t + 1) / (m4.total + 2)) * 2;
    pX *= ((m4.x + 1) / (m4.total + 2)) * 2;
  }
  if (m6 && m6.total >= 2) {
    pT *= ((m6.t + 1) / (m6.total + 2)) * 1.5;
    pX *= ((m6.x + 1) / (m6.total + 2)) * 1.5;
  }
  if (m8 && m8.total >= 2) {
    pT *= ((m8.t + 1) / (m8.total + 2)) * 1.3;
    pX *= ((m8.x + 1) / (m8.total + 2)) * 1.3;
  }
  if (f.streak >= 4) {
    const opp = f.streakSide === 'T' ? 'X' : 'T';
    if (opp === 'T') pT *= 1.25; else pX *= 1.25;
  }
  const sum = pT + pX || 1;
  return { T: (pT / sum) * 3.5, X: (pX / sum) * 3.5 };
}

function engineMomentum(f) {
  const score = { T: 0, X: 0 };
  if (f.momentumT > 0.15) score.T += f.momentumT * 2.5;
  if (f.momentumT < -0.15) score.X += Math.abs(f.momentumT) * 2.5;
  if (f.momentumT > 0.6) score.X += 0.6;
  if (f.momentumT < -0.6) score.T += 0.6;
  return score;
}

function engineDoiXung(f, series) {
  const score = { T: 0, X: 0 };
  for (let len = 4; len <= 14; len += 2) {
    if (f[`doiXung${len}`]) score[series[len - 1]] += 1.2;
  }
  if (f.doiXungScore > 0.6) {
    const half = Math.floor(series.length / 2);
    if (series[0] === series[half]) score[series[0]] += 0.7;
  }
  return score;
}

function engineFibonacci(f) {
  const score = { T: 0, X: 0 };
  if (f.fibX > f.fibT) score.T += 0.7;
  if (f.fibT > f.fibX) score.X += 0.7;
  if (Math.abs(f.chuKyT - 1.618) < 0.3) score.T += 0.6;
  if (Math.abs(f.chuKyX - 1.618) < 0.3) score.X += 0.6;
  return score;
}

function engineNeural(f) {
  const W = {
    tyLeT: -1.4, streak: -0.4, avgRun: -0.3, momentumT: 1.3,
    reversalRate: -0.9, entropy: -0.6, doiXungScore: 0.7,
    altRatio: -0.5, nghiengT: 1.0, nghiengX: -1.0,
    trendUp: 0.8, trendDown: -0.8,
  };
  let sum = 0;
  for (const [k, w] of Object.entries(W)) {
    const val = typeof f[k] === 'boolean' ? (f[k] ? 1 : 0) : (f[k] ?? 0.5);
    sum += (val - 0.5) * w;
  }
  const sig = 1 / (1 + Math.exp(-sum * 2));
  return { T: sig * 3.5, X: (1 - sig) * 3.5 };
}

function engineReverse(f, series) {
  const score = { T: 0, X: 0 };
  const recent = series.slice(0, 8);
  const tCount = recent.filter(x => x === 'T').length;
  if (tCount >= 6) score.X += 0.8;
  if (tCount <= 2) score.T += 0.8;
  return score;
}

function engineDeepTree(f, series) {
  const score = { T: 0, X: 0 };
  function search(depth) {
    if (depth < 2) return null;
    const key = series.slice(0, depth).join('');
    let t = 0, x = 0;
    for (let i = depth; i < series.length; i++) {
      if (series.slice(i - depth, i).join('') === key) {
        if (series[i] === 'T') t++; else x++;
      }
    }
    if (t + x >= 2) return { t, x, total: t + x, depth };
    return search(depth - 1);
  }
  const m = search(15);
  if (m) {
    const w = m.depth * 0.4 * (m.total / (m.total + 2));
    score.T += (m.t / m.total) * w;
    score.X += (m.x / m.total) * w;
  }
  return score;
}

function engineChuKy(f) {
  const score = { T: 0, X: 0 };
  if (f.gapT >= f.chuKyT && f.chuKyT > 0) score.T += 0.8;
  if (f.gapX >= f.chuKyX && f.chuKyX > 0) score.X += 0.8;
  if (f.chuKyT > f.chuKyX * 1.3) score.T += 0.4;
  if (f.chuKyX > f.chuKyT * 1.3) score.X += 0.4;
  return score;
}

function engineBacThang(f, series) {
  const score = { T: 0, X: 0 };
  if (f.cauBacThang) {
    const s = series.slice(0, 12).join('');
    if (/^(TX|XT)/.test(s)) score[series[0] === 'T' ? 'X' : 'T'] += 1.0;
    else score[series[0]] += 0.8;
  }
  return score;
}

function engineHinhSin(f, series) {
  const score = { T: 0, X: 0 };
  if (f.cauHinhSin) {
    const s = series.slice(0, 6).join('');
    if (/^(TTXXTT|XXTTXX)$/.test(s)) score[series[0] === 'T' ? 'X' : 'T'] += 0.9;
  }
  return score;
}

function engineTrend3(f) {
  const score = { T: 0, X: 0 };
  if (f.trendUp) score.T += 1.0;
  if (f.trendDown) score.X += 1.0;
  if (f.g1T > 0.6 && f.g3T < 0.4) score.X += 0.6;
  if (f.g1T < 0.4 && f.g3T > 0.6) score.T += 0.6;
  return score;
}

function engineGapChuKy(f) {
  const score = { T: 0, X: 0 };
  if (f.gapT >= f.chuKyT + f.stdChuKyT) score.T += 1.2;
  if (f.gapX >= f.chuKyX + 1) score.X += 1.0;
  return score;
}

function engineMarkovStreak(f) {
  const score = { T: 0, X: 0 };
  const m = f.mk3;
  if (m && m.total >= 3) {
    const biasT = (m.t + 1) / (m.total + 2);
    const biasX = (m.x + 1) / (m.total + 2);
    if (f.streak >= 3) {
      const opp = f.streakSide === 'T' ? 'X' : 'T';
      if (opp === 'T') score.T += biasT * 1.5;
      else score.X += biasX * 1.5;
    } else {
      score.T += biasT * 1.0;
      score.X += biasX * 1.0;
    }
  }
  return score;
}

function engineMarkovMulti(f) {
  const score = { T: 0, X: 0 };
  for (const k of [2, 3, 4, 5, 6]) {
    const m = f[`mk${k}`];
    if (!m || m.total < 2) continue;
    const w = 1 / k;
    score.T += ((m.t + 1) / (m.total + 2)) * w;
    score.X += ((m.x + 1) / (m.total + 2)) * w;
  }
  return score;
}

// ================== DANH SÁCH 20 ENGINES ==================
const ENGINES = [
  { name: 'markov',        fn: engineMarkov,       w: 1.6,  layer: 'cao' },
  { name: 'streak',        fn: engineStreak,       w: 1.4,  layer: 'trung' },
  { name: 'frequency',     fn: engineFrequency,    w: 0.7,  layer: 'thap' },
  { name: 'cauCoDien',     fn: engineCauCoDien,    w: 1.5,  layer: 'trung' },
  { name: 'cauPhucTap',    fn: engineCauPhucTap,   w: 1.3,  layer: 'trung' },
  { name: 'ngram',         fn: engineNGram,        w: 1.5,  layer: 'cao' },
  { name: 'bayesian',      fn: engineBayesian,     w: 1.3,  layer: 'cao' },
  { name: 'momentum',      fn: engineMomentum,     w: 0.9,  layer: 'trung' },
  { name: 'doiXung',       fn: engineDoiXung,      w: 0.9,  layer: 'trung' },
  { name: 'fibonacci',     fn: engineFibonacci,    w: 0.7,  layer: 'thap' },
  { name: 'neural',        fn: engineNeural,       w: 1.2,  layer: 'cao' },
  { name: 'reverse',       fn: engineReverse,      w: 0.6,  layer: 'thap' },
  { name: 'deepTree',      fn: engineDeepTree,     w: 1.4,  layer: 'cao' },
  { name: 'chuKy',         fn: engineChuKy,        w: 1.0,  layer: 'trung' },
  { name: 'bacThang',      fn: engineBacThang,     w: 0.8,  layer: 'trung' },
  { name: 'hinhSin',       fn: engineHinhSin,      w: 0.8,  layer: 'trung' },
  { name: 'trend3',        fn: engineTrend3,       w: 1.1,  layer: 'cao' },
  { name: 'gapChuKy',      fn: engineGapChuKy,     w: 1.2,  layer: 'cao' },
  { name: 'markovStreak',  fn: engineMarkovStreak, w: 1.3,  layer: 'cao' },
  { name: 'markovMulti',   fn: engineMarkovMulti,  w: 1.2,  layer: 'cao' },
];

// =====================================================================
//        ANTI-BIAS MODULE — Fix lỗi đoán mãi 1 cửa
// =====================================================================
function checkBias(gameKey, predictSide) {
  const mem = memory[gameKey];
  const recent = mem.lastPredictions.slice(0, 10);
  if (recent.length < 8) return { bias: false, ratio: 0 };

  const countSide = recent.filter(p => p === predictSide).length;
  const ratio = countSide / recent.length;

  // Nếu 80%+ dự đoán gần nhất cùng 1 bên → bias cao
  return { bias: ratio >= 0.8, ratio };
}

function applyAntiBias(gameKey, predictSide, confidence, feats, gameProfile) {
  const biasCheck = checkBias(gameKey, predictSide);

  if (!biasCheck.bias) {
    return { predictSide, confidence, biasAdjusted: false };
  }

  // Nếu đang bias mà cầu hiện tại cho thấy bên kia cũng có lý
  const opp = predictSide === 'T' ? 'X' : 'T';

  // Kiểm tra bên đối có dấu hiệu rõ không
  const strongSignalOpp =
    (opp === 'T' && (feats.nghiengT || feats.trendUp || feats.gapT >= 4)) ||
    (opp === 'X' && (feats.nghiengX || feats.trendDown || feats.gapX >= 4));

  if (strongSignalOpp) {
    // Đảo dự đoán
    return {
      predictSide: opp,
      confidence: clamp(confidence - 3, 50, 80), // giảm nhẹ độ tin cậy
      biasAdjusted: true,
    };
  }

  // Nếu không có tín hiệu đảo rõ → giữ nhưng giảm confidence
  return {
    predictSide,
    confidence: clamp(confidence - 5, 50, 80),
    biasAdjusted: true,
  };
}

// =====================================================================
//       ENSEMBLE + PROFILE THEO GAME
// =====================================================================
function buildPatternKey(f) {
  return [
    f.mk2.key, f.mk4.key, f.streak, f.streakSide,
    f.cau11 ? 'C11' : 'N',
    f.cau22 ? 'C22' : 'N',
    f.cau121 ? 'C121' : 'N',
    f.alternating ? 'A' : 'N',
    f.ngram4.key,
  ].join('|');
}

function ensemblePredict(feats, series, gameKey) {
  const mem = memory[gameKey];
  const profile = GAMES[gameKey].profile;
  const uuTien = new Set(profile.uuTienCau);

  const layerVotes = {
    cao: { T: 0, X: 0, w: 0 },
    trung: { T: 0, X: 0, w: 0 },
    thap: { T: 0, X: 0, w: 0 },
  };
  const engineResults = {};
  const votes = { T: 0, X: 0 };

  for (const eng of ENGINES) {
    const s = eng.fn(feats, series);
    engineResults[eng.name] = s;

    const learned = mem.engines.get(eng.name);
    let weight = learned
      ? learned.weight * 0.7 + eng.w * 0.3
      : eng.w;

    // Ưu tiên engine theo profile game (+20% trọng số)
    if (uuTien.has(eng.name)) weight *= 1.2;

    // Momentum: engine đang thắng/thua liên tiếp
    if (learned && learned.recentAcc !== undefined && learned.acc !== undefined) {
      const momentum = learned.recentAcc - learned.acc;
      if (momentum > 0.1) weight *= 1.1;
      if (momentum < -0.1) weight *= 0.85;
    }

    const total = s.T + s.X;
    if (total > 0) {
      const tR = s.T / total, xR = s.X / total;
      votes.T += tR * weight;
      votes.X += xR * weight;
      layerVotes[eng.layer].T += tR * weight;
      layerVotes[eng.layer].X += xR * weight;
      layerVotes[eng.layer].w += weight;
    }
  }

  let predictSide = votes.T >= votes.X ? 'T' : 'X';
  const totalVote = votes.T + votes.X || 1;
  const doLech = Math.abs(votes.T - votes.X) / totalVote;

  let dongThuan = 0, tongEngine = 0;
  for (const eng of ENGINES) {
    const s = engineResults[eng.name];
    const t = s.T + s.X;
    if (t === 0) continue;
    tongEngine++;
    if ((s.T >= s.X ? 'T' : 'X') === predictSide) dongThuan++;
  }
  const tyLeDongThuan = tongEngine > 0 ? dongThuan / tongEngine : 0.5;

  // Layer đồng thuận
  let layerDongThuan = 0;
  for (const l of ['cao', 'trung', 'thap']) {
    const lv = layerVotes[l];
    if (lv.T + lv.X === 0) continue;
    if ((lv.T >= lv.X ? 'T' : 'X') === predictSide) layerDongThuan++;
  }
  const tyLeLayer = layerDongThuan / 3;

  // Pattern bonus
  const patKey = buildPatternKey(feats);
  let patternBonus = 0;
  if (mem.patterns.has(patKey)) {
    const p = mem.patterns.get(patKey);
    const total = p.correct + p.wrong;
    if (total >= 5) patternBonus = (p.correct / total - 0.5) * 0.12;
  }

  // Streak win bonus
  const streakWinBonus = Math.min(mem.stats.streakWin * 0.01, 0.05);

  // Tính confidence ban đầu
  let confidence = 50
    + doLech * 18
    + tyLeDongThuan * 8
    + tyLeLayer * 3
    + patternBonus * 100
    + streakWinBonus * 100;

  confidence = clamp(confidence, 50, 80);

  // ========== ÁP DỤNG ANTI-BIAS ==========
  const biasResult = applyAntiBias(gameKey, predictSide, confidence, feats, profile);
  predictSide = biasResult.predictSide;
  confidence = biasResult.confidence;

  return {
    predictSide,
    predictName: sideName(predictSide),
    confidence: round(confidence, 2),
    biasAdjusted: biasResult.biasAdjusted,
  };
}

// =====================================================================
//       LEARNING
// =====================================================================
function updateEngineWeights(gameKey, list) {
  const mem = memory[gameKey];
  const series = toSeries(list);
  const window = 50;
  const hits = new Map(), totals = new Map();
  const recentHits = new Map(), recentTotals = new Map();

  for (let i = 8; i < Math.min(window, series.length - 1); i++) {
    const sub = series.slice(i);
    const f = detectAllPatterns(sub);
    for (const eng of ENGINES) {
      const s = eng.fn(f, sub);
      const total = s.T + s.X;
      if (total === 0) continue;
      const pred = s.T >= s.X ? 'T' : 'X';
      const actual = series[i - 1];

      if (!hits.has(eng.name)) { hits.set(eng.name, 0); totals.set(eng.name, 0); }
      totals.set(eng.name, totals.get(eng.name) + 1);
      if (pred === actual) hits.set(eng.name, hits.get(eng.name) + 1);

      if (i < 18) {
        if (!recentHits.has(eng.name)) { recentHits.set(eng.name, 0); recentTotals.set(eng.name, 0); }
        recentTotals.set(eng.name, recentTotals.get(eng.name) + 1);
        if (pred === actual) recentHits.set(eng.name, recentHits.get(eng.name) + 1);
      }
    }
  }

  for (const eng of ENGINES) {
    const total = totals.get(eng.name) || 0;
    if (total < 10) continue;
    const acc = hits.get(eng.name) / total;
    const recentTotal = recentTotals.get(eng.name) || 0;
    const recentAcc = recentTotal > 0 ? recentHits.get(eng.name) / recentTotal : acc;

    const targetW = eng.w * (0.5 + acc * 1.0);
    const old = mem.engines.get(eng.name);
    const oldW = old ? old.weight : eng.w;
    const momentum = (recentAcc - acc) * 0.3;
    const newW = oldW * 0.9 + (targetW + momentum) * 0.1;

    mem.engines.set(eng.name, {
      weight: clamp(newW, 0.3, 3.0),
      hits: hits.get(eng.name) || 0,
      total,
      acc: round(acc, 4),
      recentAcc: round(recentAcc, 4),
    });
  }
}

function learnFromHistory(gameKey, list) {
  const series = toSeries(list);
  const mem = memory[gameKey];

  for (let i = 8; i < series.length - 1; i++) {
    const sub = series.slice(i);
    const f = detectAllPatterns(sub);
    const key = buildPatternKey(f);
    const ens = ensemblePredict(f, sub, gameKey);
    const actual = series[i - 1];

    if (!mem.patterns.has(key)) mem.patterns.set(key, { correct: 0, wrong: 0 });
    const e = mem.patterns.get(key);
    if (ens.predictSide === actual) e.correct++; else e.wrong++;
  }
}

// =====================================================================
//       API
// =====================================================================
app.get('/api/du-doan/:ban', async (req, res) => {
  const gameKey = req.params.ban;
  if (!GAMES[gameKey]) {
    return res.status(400).json({
      loi: 'Bàn cược không hợp lệ',
      cacBanCoSan: ['taixiu', 'md5'],
    });
  }

  try {
    const r = await fetch(GAMES[gameKey].api, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const list = await r.json();
    if (!Array.isArray(list) || list.length === 0) {
      return res.status(500).json({ loi: 'Không lấy được dữ liệu' });
    }

    learnFromHistory(gameKey, list);
    updateEngineWeights(gameKey, list);

    const series = toSeries(list);
    const feats = detectAllPatterns(series);
    const result = ensemblePredict(feats, series, gameKey);

    const latest = list[0];
    const nextSession = latest.SessionId + 1;
    const mem = memory[gameKey];

    // Cập nhật đúng/sai
    const lastRec = mem.history[0];
    if (lastRec && lastRec.session < latest.SessionId) {
      const found = list.find(x => x.SessionId === lastRec.session);
      if (found && !lastRec.actual) {
        lastRec.actual = toResult(found);
        lastRec.correct = lastRec.actual === lastRec.predictSide;
        if (lastRec.correct) {
          mem.stats.win++;
          mem.stats.streakWin++;
          if (mem.stats.streakWin > mem.stats.maxStreakWin)
            mem.stats.maxStreakWin = mem.stats.streakWin;
        } else {
          mem.stats.lose++;
          mem.stats.streakWin = 0;
        }
      }
    }

    if (!lastRec || lastRec.session !== nextSession) {
      mem.history.unshift({
        session: nextSession,
        predictSide: result.predictSide,
        createdAt: new Date().toISOString(),
      });
      if (mem.history.length > 500) mem.history.pop();
    }

    // Lưu dự đoán gần đây để check bias
    mem.lastPredictions.unshift(result.predictSide);
    if (mem.lastPredictions.length > 30) mem.lastPredictions.pop();

    saveMemory();

    // JSON ngắn gọn
    res.json({
      phien: latest.SessionId,
      tong: latest.DiceSum,
      ketQua: sideName(toResult(latest)),
      phienDuDoan: nextSession,
      duDoan: result.predictName,
      tiLe: result.confidence,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ loi: e.message });
  }
});

// Debug endpoint — xem trạng thái
app.get('/debug/:ban', async (req, res) => {
  const gameKey = req.params.ban;
  if (!GAMES[gameKey]) return res.status(400).json({ loi: 'Bàn không hợp lệ' });

  try {
    const r = await fetch(GAMES[gameKey].api, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const list = await r.json();
    learnFromHistory(gameKey, list);
    updateEngineWeights(gameKey, list);

    const series = toSeries(list);
    const feats = detectAllPatterns(series);
    const result = ensemblePredict(feats, series, gameKey);
    const mem = memory[gameKey];

    const cauDangCo = [];
    if (feats.cau11_super) cauDangCo.push('Cầu 1-1 siêu mạnh');
    else if (feats.cau11_strong) cauDangCo.push('Cầu 1-1 mạnh');
    else if (feats.cau11) cauDangCo.push('Cầu 1-1');
    if (feats.cau22_super) cauDangCo.push('Cầu 2-2 siêu mạnh');
    else if (feats.cau22_strong) cauDangCo.push('Cầu 2-2 mạnh');
    else if (feats.cau22) cauDangCo.push('Cầu 2-2');
    if (feats.cau33) cauDangCo.push('Cầu 3-3');
    if (feats.cau44) cauDangCo.push('Cầu 4-4');
    if (feats.cau121) cauDangCo.push('Cầu 1-2-1');
    if (feats.cau212) cauDangCo.push('Cầu 2-1-2');
    if (feats.cau1221) cauDangCo.push('Cầu 1-2-2-1');
    if (feats.cau323) cauDangCo.push('Cầu 3-2-3');
    if (feats.cau232) cauDangCo.push('Cầu 2-3-2');
    if (feats.cau424) cauDangCo.push('Cầu 4-2-4');
    if (feats.betDai9) cauDangCo.push('Bệt dài >=9');
    else if (feats.betDai7) cauDangCo.push('Bệt dài >=7');
    else if (feats.betDai5) cauDangCo.push('Bệt dài >=5');
    if (feats.nghiengT) cauDangCo.push('Nghiêng Tài');
    if (feats.nghiengX) cauDangCo.push('Nghiêng Xỉu');
    if (feats.alternating) cauDangCo.push('Đảo liên tục');
    if (feats.trendUp) cauDangCo.push('Trend tăng Tài');
    if (feats.trendDown) cauDangCo.push('Trend tăng Xỉu');

    // Đếm bias
    const lastP = mem.lastPredictions.slice(0, 10);
    const countT = lastP.filter(p => p === 'T').length;
    const countX = lastP.filter(p => p === 'X').length;
    const bias = lastP.length >= 8
      ? (countT / lastP.length >= 0.8 ? 'Nghiêng Tài' :
         countX / lastP.length >= 0.8 ? 'Nghiêng Xỉu' : 'Cân bằng')
      : 'Chưa đủ dữ liệu';

    res.json({
      ban: GAMES[gameKey].name,
      phien: list[0].SessionId,
      duDoan: result.predictName,
      tiLe: result.confidence,
      biasAdjusted: result.biasAdjusted,
      cauDangNhanDien: cauDangCo,
      thongKe: {
        thang: mem.stats.win,
        thua: mem.stats.lose,
        chuoiThang: mem.stats.streakWin,
        patternDaHoc: mem.patterns.size,
      },
      kiemTraBias: {
        trangThai: bias,
        phanBo10PhienGanNhat: `${countT}T / ${countX}X`,
      },
      engines: ENGINES.map(e => {
        const l = mem.engines.get(e.name);
        return {
          ten: e.name,
          trongSo: l ? round(l.weight, 3) : e.w,
          doChinhXac: l ? round(l.acc * 100, 1) : null,
        };
      }),
    });
  } catch (e) {
    res.status(500).json({ loi: e.message });
  }
});

// Route gốc
app.get('/', (req, res) => {
  res.json({
    ten: 'API Tài Xỉu VIP',
    phienBan: '9.0',
    tinhNang: [
      '20 engines, 50+ loại cầu',
      'Anti-bias (chống đoán lệch 1 cửa)',
      'Profile riêng cho từng game',
      'Không random',
    ],
    api: {
      duDoanTaixiu: '/api/du-doan/taixiu',
      duDoanMd5: '/api/du-doan/md5',
      debugTaixiu: '/debug/taixiu',
      debugMd5: '/debug/md5',
    },
  });
});

// START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API VIP 9.0 tại http://localhost:${PORT}`);
  console.log(`📊 Tài Xỉu: http://localhost:${PORT}/api/du-doan/taixiu`);
  console.log(`📊 MD5:     http://localhost:${PORT}/api/du-doan/md5`);
  console.log(`🔍 Debug:   http://localhost:${PORT}/debug/taixiu`);
});
