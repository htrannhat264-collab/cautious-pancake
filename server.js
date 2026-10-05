// server.js — VIP 8.0: 20 engines, 50+ cầu, multi-layer voting
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

// ================== CẤU HÌNH ==================
const GAMES = {
  taixiu: {
    name: 'Tài Xỉu',
    api: 'https://taixiu.maksh3979madfw.com/api/luckydice/GetSoiCau',
  },
  md5: {
    name: 'Tài Xỉu MD5',
    api: 'https://taixiumd5.maksh3979madfw.com/api/md5luckydice/GetSoiCau',
  },
};

// ================== BỘ NHỚ ==================
const memory = {
  taixiu: {
    patterns: new Map(),
    engines: new Map(),
    history: [],
    stats: { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 },
  },
  md5: {
    patterns: new Map(),
    engines: new Map(),
    history: [],
    stats: { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 },
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
    }
    console.log('✅ Đã tải bộ nhớ VIP 8.0');
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
//        BỘ NHẬN DIỆN CẦU VIP — 50+ LOẠI (5 CẤP ĐỘ)
// =====================================================================
function detectAllPatterns(series) {
  const s = series.slice(0, 100);
  const n = s.length;
  const joined = s.join('');
  const feats = {};

  // ========== CẤP 1: VI MÔ ==========
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
  const meanRun = feats.avgRun;
  feats.stdRun = Math.sqrt(runs.reduce((a, b) => a + (b - meanRun) ** 2, 0) / runs.length);
  feats.medianRun = [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)];

  // ========== CẤP 2: TRUNG MÔ — 25+ LOẠI CẦU ==========
  // Cầu 1-1
  feats.cau11 = /(TX|XT){4,}/.test(joined);
  feats.cau11_strong = /(TX|XT){6,}/.test(joined);
  feats.cau11_super = /(TX|XT){10,}/.test(joined);

  // Cầu 2-2
  feats.cau22 = /(TTXX|XXTT){2,}/.test(joined);
  feats.cau22_strong = /(TTXX|XXTT){3,}/.test(joined);
  feats.cau22_super = /(TTXX|XXTT){4,}/.test(joined);

  // Cầu 3-3
  feats.cau33 = /(TTTXXX|XXXTTT){2,}/.test(joined);

  // Cầu 4-4
  feats.cau44 = /(TTTTXXXX|XXXXTTTT)/.test(joined);

  // Cầu 1-2-1
  feats.cau121 = /TXXT|XTTX/.test(joined);
  feats.cau121_nested = /TXXTTXXT|XTTXXTTX/.test(joined);

  // Cầu 2-1-2
  feats.cau212 = /TTXXTT|XXTTXX/.test(joined);

  // Cầu 1-2-2-1 (đối xứng)
  feats.cau1221 = /TXXTTXXT|XTTXXTTX/.test(joined);

  // Cầu 3-2-3
  feats.cau323 = /TTTXXTTT|XXXTTXXX/.test(joined);

  // Cầu 2-3-2
  feats.cau232 = /TTXXXTT|XXTTTXX/.test(joined);

  // Cầu 4-2-4
  feats.cau424 = /TTTTXXTTTT|XXXXTTXXXX/.test(joined);

  // Bệt dài
  feats.betDai3 = /(TTT|XXX)/.test(joined);
  feats.betDai5 = /(TTTTT|XXXXX)/.test(joined);
  feats.betDai7 = /(TTTTTTT|XXXXXXX)/.test(joined);
  feats.betDai9 = /(TTTTTTTTT|XXXXXXXXX)/.test(joined);

  // Cầu gãy
  feats.cauGay1 = /(TTX|XXT)/.test(joined);
  feats.cauGay2 = /(TTXXT|XXTTX)/.test(joined);

  // Nghiêng
  const countT = s.filter(x => x === 'T').length;
  const countX = n - countT;
  feats.tyLeT = countT / n;
  feats.tyLeX = countX / n;
  feats.nghiengT = feats.tyLeT > 0.65;
  feats.nghiengX = feats.tyLeX > 0.65;
  feats.nghiengCuc = feats.tyLeT > 0.75 || feats.tyLeX > 0.75;

  // Cầu tăng dần (1-1, 2-2, 3-3, 4-4) — "cầu bậc thang"
  feats.cauBacThang = /(TX|XT)(TTXX|XXTT)(TTTXXX|XXXTTT)/.test(joined);

  // Cầu hình sin
  feats.cauHinhSin = /(TTXXTT|XXTTXX|TTXXXTT)/.test(joined);

  // ========== CẤP 3: VĨ MÔ ==========
  const pT = feats.tyLeT, pX = feats.tyLeX;
  feats.entropy = -(pT * Math.log2(pT || 0.0001) + pX * Math.log2(pX || 0.0001));

  // Chu kỳ T
  let cycleT = [], lastT = -1;
  for (let i = 0; i < n; i++) {
    if (s[i] === 'T') {
      if (lastT !== -1) cycleT.push(i - lastT);
      lastT = i;
    }
  }
  feats.chuKyT = cycleT.length > 0
    ? cycleT.reduce((a, b) => a + b, 0) / cycleT.length : 2;
  feats.stdChuKyT = cycleT.length > 1
    ? Math.sqrt(cycleT.reduce((a, b) => a + (b - feats.chuKyT) ** 2, 0) / cycleT.length)
    : 0;

  // Chu kỳ X
  let cycleX = [], lastX = -1;
  for (let i = 0; i < n; i++) {
    if (s[i] === 'X') {
      if (lastX !== -1) cycleX.push(i - lastX);
      lastX = i;
    }
  }
  feats.chuKyX = cycleX.length > 0
    ? cycleX.reduce((a, b) => a + b, 0) / cycleX.length : 2;

  // Gap
  feats.gapT = s.indexOf('T');
  feats.gapX = s.indexOf('X');
  if (feats.gapT === -1) feats.gapT = 99;
  if (feats.gapX === -1) feats.gapX = 99;

  // Xu hướng 3 giai đoạn
  const g1 = s.slice(0, 15);   // gần nhất
  const g2 = s.slice(15, 30);  // vừa
  const g3 = s.slice(30, 45);  // cũ
  feats.g1T = g1.filter(x => x === 'T').length / 15;
  feats.g2T = g2.filter(x => x === 'T').length / 15;
  feats.g3T = g3.filter(x => x === 'T').length / 15;
  feats.trendUp = feats.g1T > feats.g2T && feats.g2T > feats.g3T;
  feats.trendDown = feats.g1T < feats.g2T && feats.g2T < feats.g3T;

  // ========== CẤP 4: MARKOV + N-GRAM ==========
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

  // ========== CẤP 5: ĐỐI XỨNG + FIBONACCI + MOMENTUM ==========
  for (let len = 4; len <= 14; len += 2) {
    const palin = s.slice(0, len).join('');
    feats[`doiXung${len}`] = palin === palin.split('').reverse().join('');
  }

  const half = Math.floor(n / 2);
  const fh = s.slice(0, half).join('');
  const sh = s.slice(half, half * 2).join('');
  let same = 0;
  for (let i = 0; i < Math.min(fh.length, sh.length); i++) {
    if (fh[i] === sh[i]) same++;
  }
  feats.doiXungScore = same / Math.min(fh.length, sh.length);

  // Fibonacci
  const fibs = [1, 2, 3, 5, 8, 13, 21, 34, 55];
  let fibT = 0, fibX = 0;
  for (const f of fibs) {
    if (s[f] === 'T') fibT++; else if (s[f] === 'X') fibX++;
  }
  feats.fibT = fibT;
  feats.fibX = fibX;

  // Momentum
  const r10 = s.slice(0, 10);
  const o10 = s.slice(10, 20);
  feats.momentumT = (r10.filter(x => x === 'T').length / 10) -
                    (o10.filter(x => x === 'T').length / 10);
  feats.momentumX = -feats.momentumT;

  // Alternating
  let alt = 0;
  for (let i = 1; i < n; i++) if (s[i] !== s[i - 1]) alt++;
  feats.altRatio = alt / (n - 1);
  feats.alternating = feats.altRatio > 0.65;

  // Reversal
  let rev = 0;
  for (let i = 1; i < n - 1; i++) {
    if (s[i] !== s[i - 1] && s[i] !== s[i + 1]) rev++;
  }
  feats.reversalRate = n > 2 ? rev / (n - 2) : 0;

  // Lệch vị trí chẵn/lẻ
  let evenT = 0, evenTotal = 0;
  for (let i = 0; i < n; i += 2) {
    evenTotal++;
    if (s[i] === 'T') evenT++;
  }
  feats.leViTriT = evenTotal > 0 ? evenT / evenTotal : 0.5;

  return feats;
}

// =====================================================================
//        20 ENGINES — MỖI ENGINE MỘT CHIẾN LƯỢC RIÊNG
// =====================================================================

// ENGINE 1: MARKOV CHAIN bậc 1-15
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

// ENGINE 2: STREAK BREAKER
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

// ENGINE 3: FREQUENCY
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

// ENGINE 4: CẦU CỔ ĐIỂN
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

// ENGINE 5: CẦU PHỨC TẠP
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

// ENGINE 6: N-GRAM
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

// ENGINE 7: BAYESIAN
function engineBayesian(f) {
  let pT = 0.5, pX = 0.5;
  const m4 = f.mk4;
  if (m4 && m4.total >= 3) {
    pT *= ((m4.t + 1) / (m4.total + 2)) * 2;
    pX *= ((m4.x + 1) / (m4.total + 2)) * 2;
  }
  const m6 = f.mk6;
  if (m6 && m6.total >= 2) {
    pT *= ((m6.t + 1) / (m6.total + 2)) * 1.5;
    pX *= ((m6.x + 1) / (m6.total + 2)) * 1.5;
  }
  const m8 = f.mk8;
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

// ENGINE 8: MOMENTUM
function engineMomentum(f) {
  const score = { T: 0, X: 0 };
  if (f.momentumT > 0.15) score.T += f.momentumT * 2.5;
  if (f.momentumT < -0.15) score.X += Math.abs(f.momentumT) * 2.5;
  if (f.momentumT > 0.6) score.X += 0.6;
  if (f.momentumT < -0.6) score.T += 0.6;
  return score;
}

// ENGINE 9: ĐỐI XỨNG
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

// ENGINE 10: FIBONACCI
function engineFibonacci(f) {
  const score = { T: 0, X: 0 };
  if (f.fibX > f.fibT) score.T += 0.7;
  if (f.fibT > f.fibX) score.X += 0.7;
  if (Math.abs(f.chuKyT - 1.618) < 0.3) score.T += 0.6;
  if (Math.abs(f.chuKyX - 1.618) < 0.3) score.X += 0.6;
  return score;
}

// ENGINE 11: NEURAL
function engineNeural(f) {
  const W = {
    tyLeT: -1.4, streak: -0.4, avgRun: -0.3, momentumT: 1.3,
    reversalRate: -0.9, entropy: -0.6, doiXungScore: 0.7,
    altRatio: -0.5, nghiengT: 1.0, nghiengX: -1.0,
    trendUp: 0.8, trendDown: -0.8, leViTriT: -0.5,
  };
  let sum = 0;
  for (const [k, w] of Object.entries(W)) {
    const val = typeof f[k] === 'boolean' ? (f[k] ? 1 : 0) : (f[k] ?? 0.5);
    sum += (val - 0.5) * w;
  }
  const sig = 1 / (1 + Math.exp(-sum * 2));
  return { T: sig * 3.5, X: (1 - sig) * 3.5 };
}

// ENGINE 12: REVERSE PSYCHOLOGY
function engineReverse(f, series) {
  const score = { T: 0, X: 0 };
  const recent = series.slice(0, 8);
  const tCount = recent.filter(x => x === 'T').length;
  if (tCount >= 6) score.X += 0.8;
  if (tCount <= 2) score.T += 0.8;
  return score;
}

// ENGINE 13: DEEP TREE
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

// ENGINE 14: CHU KỲ
function engineChuKy(f) {
  const score = { T: 0, X: 0 };
  if (f.gapT >= f.chuKyT && f.chuKyT > 0) score.T += 0.8;
  if (f.gapX >= f.chuKyX && f.chuKyX > 0) score.X += 0.8;
  if (f.chuKyT > f.chuKyX * 1.3) score.T += 0.4;
  if (f.chuKyX > f.chuKyT * 1.3) score.X += 0.4;
  if (f.stdChuKyT < 1 && f.gapT >= 2) score.T += 0.5;
  return score;
}

// ENGINE 15: CẦU BẬC THANG
function engineBacThang(f, series) {
  const score = { T: 0, X: 0 };
  if (f.cauBacThang) {
    const s = series.slice(0, 12).join('');
    if (/^(TX|XT)/.test(s)) score[series[0] === 'T' ? 'X' : 'T'] += 1.0;
    else score[series[0]] += 0.8;
  }
  return score;
}

// ENGINE 16: CẦU HÌNH SIN
function engineHinhSin(f, series) {
  const score = { T: 0, X: 0 };
  if (f.cauHinhSin) {
    const s = series.slice(0, 6).join('');
    if (/^(TTXXTT|XXTTXX)$/.test(s)) {
      score[series[0] === 'T' ? 'X' : 'T'] += 0.9;
    }
  }
  return score;
}

// ENGINE 17: TREND 3 GIAI ĐOẠN
function engineTrend3(f) {
  const score = { T: 0, X: 0 };
  if (f.trendUp) score.T += 1.0;
  if (f.trendDown) score.X += 1.0;
  // Nếu trend đảo
  if (f.g1T > 0.6 && f.g3T < 0.4) score.X += 0.6;
  if (f.g1T < 0.4 && f.g3T > 0.6) score.T += 0.6;
  return score;
}

// ENGINE 18: GAP + CHU KỲ KẾT HỢP
function engineGapChuKy(f) {
  const score = { T: 0, X: 0 };
  // Nếu gap T vượt chu kỳ T rõ rệt
  if (f.gapT >= f.chuKyT + f.stdChuKyT) score.T += 1.2;
  if (f.gapX >= f.chuKyX + 1) score.X += 1.0;
  return score;
}

// ENGINE 19: MARKOV + STREAK KẾT HỢP
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

// ENGINE 20: ENSEMBLE MARKOV ĐA BẬC
function engineMarkovMulti(f) {
  const score = { T: 0, X: 0 };
  const keys = [2, 3, 4, 5, 6];
  for (const k of keys) {
    const m = f[`mk${k}`];
    if (!m || m.total < 2) continue;
    const biasT = (m.t + 1) / (m.total + 2);
    const biasX = (m.x + 1) / (m.total + 2);
    const w = 1 / k;
    score.T += biasT * w;
    score.X += biasX * w;
  }
  return score;
}

// =====================================================================
//        20 ENGINES — DANH SÁCH + TRỌNG SỐ MẶC ĐỊNH
// =====================================================================
const ENGINES = [
  { name: 'markov',        fn: engineMarkov,       w: 1.6,  layer: 'cao' },
  { name: 'streak',        fn: engineStreak,       w: 1.4,  layer: 'trung' },
  { name: 'frequency',     fn: engineFrequency,    w: 1.1,  layer: 'trung' },
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
//        MULTI-LAYER VOTING: CAO / TRUNG / THẤP
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

  const layerVotes = {
    cao: { T: 0, X: 0, weight: 0 },
    trung: { T: 0, X: 0, weight: 0 },
    thap: { T: 0, X: 0, weight: 0 },
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

    // Nếu engine đang thua nhiều liên tiếp → giảm weight
    if (learned && learned.streakLoss >= 3) {
      weight *= 0.7;
    }
    // Nếu engine đang thắng nhiều liên tiếp → tăng weight
    if (learned && learned.streakWin >= 3) {
      weight *= 1.15;
    }

    const total = s.T + s.X;
    if (total > 0) {
      const tRatio = s.T / total;
      const xRatio = s.X / total;
      votes.T += tRatio * weight;
      votes.X += xRatio * weight;
      layerVotes[eng.layer].T += tRatio * weight;
      layerVotes[eng.layer].X += xRatio * weight;
      layerVotes[eng.layer].weight += weight;
    }
  }

  const predictSide = votes.T >= votes.X ? 'T' : 'X';
  const totalVote = votes.T + votes.X || 1;
  const doLech = Math.abs(votes.T - votes.X) / totalVote;

  // Đồng thuận engine
  let dongThuan = 0, tongEngine = 0;
  for (const eng of ENGINES) {
    const s = engineResults[eng.name];
    const t = s.T + s.X;
    if (t === 0) continue;
    tongEngine++;
    if ((s.T >= s.X ? 'T' : 'X') === predictSide) dongThuan++;
  }
  const tyLeDongThuan = tongEngine > 0 ? dongThuan / tongEngine : 0.5;

  // Đồng thuận 3 layer
  let layerDongThuan = 0;
  for (const layer of ['cao', 'trung', 'thap']) {
    const lv = layerVotes[layer];
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
    if (total >= 5) {
      patternBonus = (p.correct / total - 0.5) * 0.12;
    }
  }

  // Chuỗi thắng hiện tại
  const streakWinBonus = Math.min(mem.stats.streakWin * 0.01, 0.05);

  // Công thức cuối
  let confidence = 50
    + doLech * 18         // 0 → 18
    + tyLeDongThuan * 8   // 0 → 8
    + tyLeLayer * 3       // 0 → 3
    + patternBonus * 100  // -6 → +6
    + streakWinBonus * 100; // 0 → 5

  confidence = clamp(confidence, 50, 80);
  confidence = round(confidence, 2);

  return {
    predictSide,
    predictName: sideName(predictSide),
    confidence,
    chiTiet: {
      doLech: round(doLech * 100, 2),
      dongThuan: `${dongThuan}/${tongEngine}`,
      tyLeDongThuan: round(tyLeDongThuan * 100, 2),
      tyLeLayer: round(tyLeLayer * 100, 2),
    },
  };
}

// =====================================================================
//        LEARNING — Weight + Momentum
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

      // Recent window (10 phiên gần nhất)
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
    const recentAcc = recentTotal > 0
      ? recentHits.get(eng.name) / recentTotal
      : acc;

    // Target weight dựa trên accuracy
    const targetW = eng.w * (0.5 + acc * 1.0);
    const old = mem.engines.get(eng.name);
    const oldW = old ? old.weight : eng.w;

    // EMA chậm + momentum từ recent acc
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
//        API — JSON NGẮN GỌN
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

    // Cập nhật lịch sử
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

    saveMemory();

    // ============== JSON NGẮN GỌN ==============
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

// ================== ROUTE GỐC ==================
app.get('/', (req, res) => {
  res.json({
    ten: 'API Dự Đoán Tài Xỉu VIP',
    phienBan: '8.0',
    moTa: '20 engines, 50+ loại cầu, multi-layer voting, không random',
    cacBan: {
      taixiu: '/api/du-doan/taixiu',
      md5: '/api/du-doan/md5',
    },
    congThucTiLe:
      '50% + độ lệch × 18% + đồng thuận × 8% + layer × 3% + pattern bonus + streak win',
  });
});

// ================== START ==================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API VIP 8.0 chạy tại http://localhost:${PORT}`);
  console.log(`📊 Tài Xỉu: http://localhost:${PORT}/api/du-doan/taixiu`);
  console.log(`📊 MD5:     http://localhost:${PORT}/api/du-doan/md5`);
});
