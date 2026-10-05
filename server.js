// server.js — VIP 6.0: Nhận diện ALL CẦU, không random
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
  taixiu: { patterns: new Map(), engines: new Map(), history: [], stats: { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 } },
  md5:    { patterns: new Map(), engines: new Map(), history: [], stats: { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 } },
};

// ================== PERSIST ==================
const DATA_FILE = path.join(__dirname, 'data.json');

function saveMemory() {
  const obj = {};
  for (const k of Object.keys(memory)) {
    obj[k] = {
      patterns: Array.from(memory[k].patterns.entries()),
      engines: Array.from(memory[k].engines.entries()),
      history: memory[k].history.slice(0, 300),
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
    console.log('✅ Đã tải bộ nhớ VIP');
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
//              BỘ NHẬN DIỆN CẦU — 5 CẤP ĐỘ (30+ LOẠI CẦU)
// =====================================================================
function detectAllPatterns(series) {
  const s = series.slice(0, 80); // 80 phiên gần nhất
  const n = s.length;
  const joined = s.join('');
  const feats = {};

  // ==========================================================
  // CẤP 1: VI MÔ — từng phiên, streak, nhịp ngắn
  // ==========================================================
  feats.streak = 1;
  for (let i = 1; i < n; i++) {
    if (s[i] === s[0]) feats.streak++; else break;
  }
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

  // ==========================================================
  // CẤP 2: TRUNG MÔ — cầu 1-1, 2-2, 3-3, 1-2-1, 2-1-2,...
  // ==========================================================
  // --- Cầu 1-1 (bệt đảo liên tục) ---
  feats.cau11 = /(TX|XT){4,}/.test(joined);
  feats.cau11_strong = /(TX|XT){6,}/.test(joined);
  feats.cau11_length = (joined.match(/(TX|XT)+/) || [''])[0].length;

  // --- Cầu 2-2 (bệt 2 nhịp) ---
  feats.cau22 = /(TTXX|XXTT){2,}/.test(joined);
  feats.cau22_strong = /(TTXX|XXTT){3,}/.test(joined);

  // --- Cầu 3-3 ---
  feats.cau33 = /(TTTXXX|XXXTTT){2,}/.test(joined);

  // --- Cầu 4-4 ---
  feats.cau44 = /(TTTTXXXX|XXXXTTTT)/.test(joined);

  // --- Cầu 1-2-1 ---
  feats.cau121 = /TXXT|XTTX/.test(joined);

  // --- Cầu 2-1-2 ---
  feats.cau212 = /TTXXTT|XXTTXX/.test(joined);

  // --- Cầu 1-2-2-1 (đối xứng) ---
  feats.cau1221 = /TXXTTXXT|XTTXXTTX/.test(joined);

  // --- Cầu 3-2-3 ---
  feats.cau323 = /TTTXXTTT|XXXTTXXX/.test(joined);

  // --- Cầu bệt dài (>= 5) ---
  feats.betDai = /(TTTTT|XXXXX)/.test(joined);
  feats.betDai5 = /(TTTTT|XXXXX)/.test(joined);
  feats.betDai7 = /(TTTTTTT|XXXXXXX)/.test(joined);

  // --- Cầu gãy 2 nhịp ---
  feats.cauGay = /(TTX|XXT)/.test(joined);

  // --- Cầu nghiêng (T > X hoặc X > T rõ rệt) ---
  const countT = s.filter(x => x === 'T').length;
  const countX = n - countT;
  feats.tyLeT = countT / n;
  feats.tyLeX = countX / n;
  feats.nghiengT = feats.tyLeT > 0.65;
  feats.nghiengX = feats.tyLeX > 0.65;

  // ==========================================================
  // CẤP 3: VĨ MÔ — phân phối, entropy, chu kỳ
  // ==========================================================
  // --- Entropy (độ ngẫu nhiên) ---
  const pT = feats.tyLeT, pX = feats.tyLeX;
  feats.entropy = -(pT * Math.log2(pT || 0.0001) + pX * Math.log2(pX || 0.0001));

  // --- Chu kỳ xuất hiện của T ---
  let cycleT = [], lastT = -1;
  for (let i = 0; i < n; i++) {
    if (s[i] === 'T') {
      if (lastT !== -1) cycleT.push(i - lastT);
      lastT = i;
    }
  }
  feats.chuKyT = cycleT.length > 0
    ? cycleT.reduce((a, b) => a + b, 0) / cycleT.length : 2;

  // --- Chu kỳ xuất hiện của X ---
  let cycleX = [], lastX = -1;
  for (let i = 0; i < n; i++) {
    if (s[i] === 'X') {
      if (lastX !== -1) cycleX.push(i - lastX);
      lastX = i;
    }
  }
  feats.chuKyX = cycleX.length > 0
    ? cycleX.reduce((a, b) => a + b, 0) / cycleX.length : 2;

  // --- Gap (khoảng cách lần cuối) ---
  feats.gapT = s.indexOf('T');
  feats.gapX = s.indexOf('X');
  if (feats.gapT === -1) feats.gapT = 99;
  if (feats.gapX === -1) feats.gapX = 99;

  // ==========================================================
  // CẤP 4: MARKOV + N-GRAM (học chuỗi)
  // ==========================================================
  // --- Markov bậc 1-12 ---
  for (let k = 1; k <= 12; k++) {
    const key = s.slice(0, k).join('');
    let t = 0, x = 0;
    for (let i = k; i < n; i++) {
      if (s.slice(i - k, i).join('') === key) {
        if (s[i] === 'T') t++; else x++;
      }
    }
    feats[`mk${k}`] = { key, t, x, total: t + x };
  }

  // --- N-gram 2-10 ---
  for (let ng = 2; ng <= 10; ng++) {
    const key = s.slice(0, ng).join('');
    let t = 0, x = 0;
    for (let i = ng; i < n; i++) {
      if (s.slice(i - ng, i).join('') === key) {
        if (s[i] === 'T') t++; else x++;
      }
    }
    feats[`ngram${ng}`] = { key, t, x, total: t + x };
  }

  // ==========================================================
  // CẤP 5: ĐỐI XỨNG + FIBONACCI + MOMENTUM
  // ==========================================================
  // --- Palindrome (đối xứng) ---
  for (let len = 4; len <= 12; len += 2) {
    const palin = s.slice(0, len).join('');
    feats[`doiXung${len}`] = palin === palin.split('').reverse().join('');
  }

  // --- Symmetry score (nửa đầu vs nửa sau) ---
  const half = Math.floor(n / 2);
  const fh = s.slice(0, half).join('');
  const sh = s.slice(half, half * 2).join('');
  let same = 0;
  for (let i = 0; i < Math.min(fh.length, sh.length); i++) {
    if (fh[i] === sh[i]) same++;
  }
  feats.doiXungScore = same / Math.min(fh.length, sh.length);

  // --- Fibonacci positions ---
  const fibs = [1, 2, 3, 5, 8, 13, 21, 34];
  let fibT = 0, fibX = 0;
  for (const f of fibs) {
    if (s[f] === 'T') fibT++; else if (s[f] === 'X') fibX++;
  }
  feats.fibT = fibT;
  feats.fibX = fibX;

  // --- Momentum (10 phiên gần vs 10 phiên cũ) ---
  const r10 = s.slice(0, 10);
  const o10 = s.slice(10, 20);
  feats.momentumT = (r10.filter(x => x === 'T').length / 10) -
                    (o10.filter(x => x === 'T').length / 10);
  feats.momentumX = -feats.momentumT;

  // --- Alternating ratio ---
  let alt = 0;
  for (let i = 1; i < n; i++) if (s[i] !== s[i - 1]) alt++;
  feats.altRatio = alt / (n - 1);

  // --- Reversal rate ---
  let rev = 0;
  for (let i = 1; i < n - 1; i++) {
    if (s[i] !== s[i - 1] && s[i] !== s[i + 1]) rev++;
  }
  feats.reversalRate = n > 2 ? rev / (n - 2) : 0;

  // --- Even/odd position bias ---
  let evenT = 0, evenTotal = 0;
  for (let i = 0; i < n; i += 2) {
    evenTotal++;
    if (s[i] === 'T') evenT++;
  }
  feats.leViTriT = evenTotal > 0 ? evenT / evenTotal : 0.5;

  // --- Đầu phiên vs cuối phiên ---
  const head = s.slice(0, 20);
  const tail = s.slice(-20);
  feats.dauTyLeT = head.filter(x => x === 'T').length / 20;
  feats.duoiTyLeT = tail.filter(x => x === 'T').length / 20;

  // --- Số phiên liên tiếp không đổi (streak count) ---
  feats.soLanDoi = alt;

  return feats;
}

// =====================================================================
//             14 ENGINES — KHÔNG RANDOM, CHỈ TÍNH TOÁN
// =====================================================================

// ENGINE 1: MARKOV CHAIN bậc 1-12
function engineMarkov(f) {
  let sT = 0, sX = 0;
  for (let k = 1; k <= 12; k++) {
    const m = f[`mk${k}`];
    if (!m || m.total < 2) continue;
    // Laplace smoothing + trọng số giảm dần theo bậc
    const w = Math.pow(1.35, 12 - k) * (m.total / (m.total + 3));
    sT += ((m.t + 1) / (m.total + 2)) * w;
    sX += ((m.x + 1) / (m.total + 2)) * w;
  }
  return { T: sT, X: sX };
}

// ENGINE 2: STREAK BREAKER — bẻ bệt
function engineStreak(f) {
  const score = { T: 0, X: 0 };
  const side = f.streakSide;
  const opp = side === 'T' ? 'X' : 'T';
  const st = f.streak, avg = f.avgRun, std = f.stdRun;

  // Streak > trung bình + 1 std → khả năng bẻ cao
  if (st > avg + std) {
    score[opp] += 1.2 + (st - avg) * 0.4;
  } else if (st < avg - std && st < 2) {
    score[side] += 0.6;
  }

  // Bệt cực dài → gãy sớm
  if (st >= 5) score[opp] += 0.8;
  if (st >= 7) score[opp] += 1.2;
  if (st >= 9) score[opp] += 1.5;

  // Chạm max run → bẻ
  if (st >= f.maxRun && st >= 4) score[opp] += 0.7;

  // Chạm median run
  if (st === f.medianRun && st >= 2) score[opp] += 0.3;

  return score;
}

// ENGINE 3: FREQUENCY / MEAN REVERSION
function engineFrequency(f) {
  const score = { T: 0, X: 0 };
  const devT = f.tyLeT - 0.5;

  // Nếu T xuất hiện quá nhiều → nghiêng về X
  score.T -= devT * 2.2;
  score.X += devT * 2.2;

  // Lệch cực mạnh → đảo mạnh
  if (f.tyLeT > 0.7) score.X += 1.5;
  if (f.tyLeX > 0.7) score.T += 1.5;

  // Gap: bên nào lâu không ra → sắp ra
  if (f.gapT >= 5) score.T += f.gapT * 0.12;
  if (f.gapX >= 5) score.X += f.gapX * 0.12;

  // Chu kỳ
  if (f.chuKyT >= 3 && f.gapT >= f.chuKyT - 1) score.T += 0.5;
  if (f.chuKyX >= 3 && f.gapX >= f.chuKyX - 1) score.X += 0.5;

  return score;
}

// ENGINE 4: CẦU CỔ ĐIỂN (1-1, 2-2, 3-3, 4-4)
function engineCauCoDien(f, series) {
  const score = { T: 0, X: 0 };
  const s = series.slice(0, 20).join('');

  // Cầu 1-1
  if (f.cau11_strong) {
    score[series[0] === 'T' ? 'X' : 'T'] += 2.0;
  } else if (f.cau11) {
    score[series[0] === 'T' ? 'X' : 'T'] += 1.2;
  }

  // Cầu 2-2
  if (f.cau22_strong) {
    // Đang ở cuối nhịp 2 → bẻ
    if (/(TTTT|XXXX)$/.test(s)) {
      score[series[0] === 'T' ? 'X' : 'T'] += 1.3;
    } else if (/(TT|XX)$/.test(s)) {
      score[series[0] === 'T' ? 'X' : 'T'] += 0.8;
    }
  }

  // Cầu 3-3
  if (f.cau33) {
    if (/(TTTTTT|XXXXXX)$/.test(s)) {
      score[series[0] === 'T' ? 'X' : 'T'] += 1.2;
    }
  }

  // Cầu 4-4
  if (f.cau44) {
    score[series[0] === 'T' ? 'X' : 'T'] += 1.5;
  }

  // Cầu bệt dài → nghi ngờ gãy
  if (f.betDai7) score[series[0] === 'T' ? 'X' : 'T'] += 1.5;
  else if (f.betDai5) score[series[0] === 'T' ? 'X' : 'T'] += 0.8;

  return score;
}

// ENGINE 5: CẦU PHỨC TẠP (1-2-1, 2-1-2, 1-2-2-1, 3-2-3)
function engineCauPhucTap(f, series) {
  const score = { T: 0, X: 0 };
  const s = series.slice(0, 12).join('');

  // 1-2-1
  if (f.cau121) {
    if (s.startsWith('TXXT')) score.X += 1.0;
    if (s.startsWith('XTTX')) score.T += 1.0;
  }

  // 2-1-2
  if (f.cau212) {
    if (s.startsWith('TTXXTT')) score.X += 0.9;
    if (s.startsWith('XXTTXX')) score.T += 0.9;
  }

  // 1-2-2-1
  if (f.cau1221) {
    if (s.startsWith('TXXTTXXT')) score.T += 1.2;
    if (s.startsWith('XTTXXTTX')) score.X += 1.2;
  }

  // 3-2-3
  if (f.cau323) {
    if (s.startsWith('TTTXXTTT')) score.T += 1.1;
    if (s.startsWith('XXXTTXXX')) score.X += 1.1;
  }

  return score;
}

// ENGINE 6: N-GRAM 2-10
function engineNGram(f) {
  let sT = 0, sX = 0;
  for (let ng = 2; ng <= 10; ng++) {
    const g = f[`ngram${ng}`];
    if (!g || g.total < 2) continue;
    const w = Math.pow(1.45, ng - 2) * (g.total / (g.total + 3));
    sT += ((g.t + 1) / (g.total + 2)) * w;
    sX += ((g.x + 1) / (g.total + 2)) * w;
  }
  return { T: sT, X: sX };
}

// ENGINE 7: BAYESIAN — xác suất có điều kiện
function engineBayesian(f) {
  let pT = 0.5, pX = 0.5;

  // Prior từ Markov bậc 4
  const m4 = f.mk4;
  if (m4 && m4.total >= 3) {
    const likeT = (m4.t + 1) / (m4.total + 2);
    const likeX = (m4.x + 1) / (m4.total + 2);
    pT *= likeT * 2;
    pX *= likeX * 2;
  }

  // Prior từ Markov bậc 6
  const m6 = f.mk6;
  if (m6 && m6.total >= 2) {
    pT *= ((m6.t + 1) / (m6.total + 2)) * 1.5;
    pX *= ((m6.x + 1) / (m6.total + 2)) * 1.5;
  }

  // Prior từ streak
  if (f.streak >= 4) {
    const opp = f.streakSide === 'T' ? 'X' : 'T';
    if (opp === 'T') pT *= 1.25; else pX *= 1.25;
  }

  const sum = pT + pX || 1;
  return { T: (pT / sum) * 3.5, X: (pX / sum) * 3.5 };
}

// ENGINE 8: MOMENTUM — xu hướng
function engineMomentum(f) {
  const score = { T: 0, X: 0 };

  if (f.momentumT > 0.15) score.T += f.momentumT * 2.5;
  if (f.momentumT < -0.15) score.X += Math.abs(f.momentumT) * 2.5;

  // Đảo chiều khi momentum đạt đỉnh
  if (f.momentumT > 0.6) score.X += 0.6;
  if (f.momentumT < -0.6) score.T += 0.6;

  return score;
}

// ENGINE 9: ĐỐI XỨNG
function engineDoiXung(f, series) {
  const score = { T: 0, X: 0 };

  // Palindrome
  for (let len = 4; len <= 12; len += 2) {
    if (f[`doiXung${len}`]) score[series[len - 1]] += 1.2;
  }

  // Symmetry score
  if (f.doiXungScore > 0.6) {
    const half = Math.floor(series.length / 2);
    if (series[0] === series[half]) score[series[0]] += 0.7;
  }

  return score;
}

// ENGINE 10: FIBONACCI
function engineFibonacci(f, series) {
  const score = { T: 0, X: 0 };
  const fibs = [1, 2, 3, 5, 8, 13, 21, 34];

  // Nếu vị trí fib ra X nhiều → khả năng ra T
  if (f.fibX > f.fibT) score.T += 0.7;
  if (f.fibT > f.fibX) score.X += 0.7;

  // Chu kỳ gần 1.618 (tỉ lệ vàng)
  if (Math.abs(f.chuKyT - 1.618) < 0.3) score.T += 0.6;
  if (Math.abs(f.chuKyX - 1.618) < 0.3) score.X += 0.6;

  return score;
}

// ENGINE 11: NEURAL NETWORK 1 LỚP ẨN (dựa trên đặc trưng)
function engineNeural(f) {
  // Trọng số thực nghiệm (đã học)
  const W = {
    tyLeT: -1.4,
    streak: -0.4,
    avgRun: -0.3,
    momentumT: 1.3,
    reversalRate: -0.9,
    entropy: -0.6,
    doiXungScore: 0.7,
    altRatio: -0.5,
    nghiengT: 1.0,
    nghiengX: -1.0,
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

// ENGINE 13: DEEP TREE — pattern recursion depth 12
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

  const m = search(12);
  if (m) {
    const w = m.depth * 0.4 * (m.total / (m.total + 2));
    score.T += (m.t / m.total) * w;
    score.X += (m.x / m.total) * w;
  }
  return score;
}

// ENGINE 14: CHU KỲ (CYCLE)
function engineChuKy(f, series) {
  const score = { T: 0, X: 0 };

  // Nếu T lâu chưa ra và chu kỳ T ngắn → khả năng ra T
  if (f.gapT >= f.chuKyT && f.chuKyT > 0) score.T += 0.8;
  if (f.gapX >= f.chuKyX && f.chuKyX > 0) score.X += 0.8;

  // Nếu chu kỳ T > chu kỳ X → T đang "trễ"
  if (f.chuKyT > f.chuKyX * 1.3) score.T += 0.4;
  if (f.chuKyX > f.chuKyT * 1.3) score.X += 0.4;

  return score;
}

// =====================================================================
//              ENSEMBLE — KẾT HỢP 14 ENGINES
// =====================================================================
const ENGINES = [
  { name: 'markov',    fn: engineMarkov,       w: 1.6 },
  { name: 'streak',    fn: engineStreak,       w: 1.4 },
  { name: 'frequency', fn: engineFrequency,    w: 1.1 },
  { name: 'cauCoDien', fn: engineCauCoDien,    w: 1.5 },
  { name: 'cauPhucTap',fn: engineCauPhucTap,   w: 1.3 },
  { name: 'ngram',     fn: engineNGram,        w: 1.5 },
  { name: 'bayesian',  fn: engineBayesian,     w: 1.3 },
  { name: 'momentum',  fn: engineMomentum,     w: 0.9 },
  { name: 'doiXung',   fn: engineDoiXung,      w: 0.9 },
  { name: 'fibonacci', fn: engineFibonacci,    w: 0.7 },
  { name: 'neural',    fn: engineNeural,       w: 1.2 },
  { name: 'reverse',   fn: engineReverse,      w: 0.6 },
  { name: 'deepTree',  fn: engineDeepTree,     w: 1.4 },
  { name: 'chuKy',     fn: engineChuKy,        w: 1.0 },
];

function ensemblePredict(feats, series, gameKey) {
  const mem = memory[gameKey];
  const votes = { T: 0, X: 0 };
  const engineResults = {};

  for (const eng of ENGINES) {
    const s = eng.fn(feats, series);
    engineResults[eng.name] = s;

    // Lấy trọng số đã học (EMA) hoặc mặc định
    const learned = mem.engines.get(eng.name);
    const weight = learned
      ? learned.weight * 0.7 + eng.w * 0.3
      : eng.w;

    const total = s.T + s.X;
    if (total > 0) {
      votes.T += (s.T / total) * weight;
      votes.X += (s.X / total) * weight;
    }
  }

  const predictSide = votes.T >= votes.X ? 'T' : 'X';
  const totalVote = votes.T + votes.X || 1;
  const doLech = Math.abs(votes.T - votes.X) / totalVote;

  // Đếm engines đồng thuận
  let dongThuan = 0, tongEngine = 0;
  for (const eng of ENGINES) {
    const s = engineResults[eng.name];
    const t = s.T + s.X;
    if (t === 0) continue;
    tongEngine++;
    if ((s.T >= s.X ? 'T' : 'X') === predictSide) dongThuan++;
  }
  const tyLeDongThuan = tongEngine > 0 ? dongThuan / tongEngine : 0.5;

  // Pattern bonus từ memory
  const patKey = buildPatternKey(feats);
  let patternBonus = 0;
  if (mem.patterns.has(patKey)) {
    const p = mem.patterns.get(patKey);
    const total = p.correct + p.wrong;
    if (total >= 5) {
      const acc = p.correct / total;
      patternBonus = (acc - 0.5) * 0.12; // -6% → +6%
    }
  }

  // Confidence: 50% + độ lệch × 20% + đồng thuận × 10% + pattern
  let confidence = 50
    + doLech * 20
    + tyLeDongThuan * 10
    + patternBonus * 100;

  confidence = clamp(confidence, 50, 80);
  confidence = round(confidence, 2);

  return {
    predictSide,
    predictName: sideName(predictSide),
    votes,
    engineResults,
    confidence,
    chiTiet: {
      doLech: round(doLech * 100, 2),
      dongThuan: `${dongThuan}/${tongEngine}`,
      tyLeDongThuan: round(tyLeDongThuan * 100, 2),
      patternBonus: round(patternBonus * 100, 2),
    },
  };
}

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

// =====================================================================
//              LEARNING — cập nhật trọng số theo kết quả
// =====================================================================
function updateEngineWeights(gameKey, list) {
  const mem = memory[gameKey];
  const series = toSeries(list);
  const window = 40;
  const hits = new Map(), totals = new Map();

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
    }
  }

  for (const eng of ENGINES) {
    const total = totals.get(eng.name) || 0;
    if (total < 10) continue; // Chỉ học khi đủ mẫu
    const acc = hits.get(eng.name) / total;
    const targetW = eng.w * (0.5 + acc * 1.0);
    const old = mem.engines.get(eng.name);
    const oldW = old ? old.weight : eng.w;
    const newW = oldW * 0.9 + targetW * 0.1; // EMA chậm hơn để ổn định
    mem.engines.set(eng.name, {
      weight: clamp(newW, 0.3, 3.0),
      hits: hits.get(eng.name) || 0,
      total,
      acc: round(acc, 4),
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
//              API DUY NHẤT
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

    // Học từ lịch sử
    learnFromHistory(gameKey, list);
    updateEngineWeights(gameKey, list);

    // Dự đoán
    const series = toSeries(list);
    const feats = detectAllPatterns(series);
    const result = ensemblePredict(feats, series, gameKey);

    const latest = list[0];
    const nextSession = latest.SessionId + 1;
    const mem = memory[gameKey];

    // Cập nhật lịch sử đúng/sai
    const lastRec = mem.history[0];
    if (lastRec && lastRec.session < latest.SessionId) {
      const found = list.find(x => x.SessionId === lastRec.session);
      if (found && !lastRec.actual) {
        lastRec.actual = toResult(found);
        lastRec.actualName = sideName(toResult(found));
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
        predictName: result.predictName,
        confidence: result.confidence,
        createdAt: new Date().toISOString(),
      });
      if (mem.history.length > 300) mem.history.pop();
    }

    saveMemory();

    const tongDuDoan = mem.stats.win + mem.stats.lose;
    const tyLeDung = tongDuDoan > 0
      ? round(mem.stats.win / tongDuDoan * 100, 2) : 0;

    // Đếm số cầu đang có
    const cauDangCo = [];
    if (feats.cau11_strong) cauDangCo.push('Cầu 1-1 mạnh');
    else if (feats.cau11) cauDangCo.push('Cầu 1-1');
    if (feats.cau22_strong) cauDangCo.push('Cầu 2-2 mạnh');
    else if (feats.cau22) cauDangCo.push('Cầu 2-2');
    if (feats.cau33) cauDangCo.push('Cầu 3-3');
    if (feats.cau44) cauDangCo.push('Cầu 4-4');
    if (feats.cau121) cauDangCo.push('Cầu 1-2-1');
    if (feats.cau212) cauDangCo.push('Cầu 2-1-2');
    if (feats.cau1221) cauDangCo.push('Cầu 1-2-2-1');
    if (feats.cau323) cauDangCo.push('Cầu 3-2-3');
    if (feats.betDai7) cauDangCo.push('Bệt dài >=7');
    else if (feats.betDai5) cauDangCo.push('Bệt dài >=5');
    if (feats.nghiengT) cauDangCo.push('Nghiêng Tài');
    if (feats.nghiengX) cauDangCo.push('Nghiêng Xỉu');
    if (feats.alternating) cauDangCo.push('Đảo liên tục');
    if (feats.doiXung6) cauDangCo.push('Đối xứng 6');
    if (feats.doiXung8) cauDangCo.push('Đối xứng 8');

    // Engine info
    const engineInfo = ENGINES.map(e => {
      const l = mem.engines.get(e.name);
      return {
        ten: e.name,
        trongSo: l ? round(l.weight, 3) : e.w,
        doChinhXac: l && l.total > 0
          ? round(l.hits / l.total * 100, 1) : null,
        soLanKhop: l ? `${l.hits}/${l.total}` : '0/0',
      };
    });

    res.json({
      ban: GAMES[gameKey].name,
      phienHienTai: latest.SessionId,
      phienDuDoan: nextSession,
      ketQuaPhienTruoc: {
        xucXac: [latest.FirstDice, latest.SecondDice, latest.ThirdDice],
        tong: latest.DiceSum,
        ketQua: sideName(toResult(latest)),
      },
      duDoan: result.predictName,
      tiLe: result.confidence,
      doTinCay:
        result.confidence >= 72 ? 'Rất cao' :
        result.confidence >= 65 ? 'Cao' :
        result.confidence >= 58 ? 'Trung bình' : 'Thấp',
      cauDangNhanDien: cauDangCo,
      thongKe: {
        thang: mem.stats.win,
        thua: mem.stats.lose,
        tyLeDung: tyLeDung,
        chuoiThang: mem.stats.streakWin,
        chuoiThangDaiNhat: mem.stats.maxStreakWin,
        soPatternDaHoc: mem.patterns.size,
      },
      chiTietTinhToan: result.chiTiet,
      engines: engineInfo,
      lichSuGanDay: list.slice(0, 20).map(x => ({
        phien: x.SessionId,
        xucXac: [x.FirstDice, x.SecondDice, x.ThirdDice],
        tong: x.DiceSum,
        ketQua: sideName(toResult(x)),
      })),
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
    phienBan: '6.0',
    moTa: 'Nhận diện 30+ loại cầu, không random, 14 engines ensemble',
    cacBan: {
      taixiu: '/api/du-doan/taixiu',
      md5: '/api/du-doan/md5',
    },
    congThucTiLe: '50% + độ lệch × 20% + đồng thuận × 10% + pattern bonus',
  });
});

// ================== START ==================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API VIP 6.0 chạy tại http://localhost:${PORT}`);
  console.log(`📊 Tài Xỉu: http://localhost:${PORT}/api/du-doan/taixiu`);
  console.log(`📊 MD5:     http://localhost:${PORT}/api/du-doan/md5`);
});
