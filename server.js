// server.js — PHIÊN BẢN NÂNG CẤP CỰC MẠNH v3.0
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================== CẤU HÌNH ==================
export const GAMES = {
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
export const memory = {
  taixiu: {
    patterns: new Map(),
    engineWeights: new Map(),
    engineStats: new Map(),
    stats: { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 },
    history: [],
    transitions: new Map(),
  },
  md5: {
    patterns: new Map(),
    engineWeights: new Map(),
    engineStats: new Map(),
    stats: { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 },
    history: [],
    transitions: new Map(),
  },
};

// ================== PERSIST ==================
const DATA_FILE = path.join(__dirname, 'data.json');

export function saveMemory() {
  const obj = {};
  for (const k of Object.keys(memory)) {
    obj[k] = {
      patterns: Array.from(memory[k].patterns.entries()),
      engineWeights: Array.from(memory[k].engineWeights.entries()),
      engineStats: Array.from(memory[k].engineStats.entries()),
      stats: memory[k].stats,
      history: memory[k].history.slice(0, 1000),
      transitions: Array.from(memory[k].transitions.entries()),
    };
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

export function loadMemory() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const obj = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const k of Object.keys(obj)) {
      if (!memory[k]) continue;
      memory[k].patterns = new Map(obj[k].patterns || []);
      memory[k].engineWeights = new Map(obj[k].engineWeights || []);
      memory[k].engineStats = new Map(obj[k].engineStats || []);
      memory[k].stats = obj[k].stats || { win: 0, lose: 0, streakWin: 0, maxStreakWin: 0 };
      memory[k].history = obj[k].history || [];
      memory[k].transitions = new Map(obj[k].transitions || []);
    }
    console.log('✅ Đã tải bộ nhớ');
  } catch (e) { console.error('Load memory lỗi:', e.message); }
}
loadMemory();

// ================== HELPERS ==================
export const toResult = (s) => s.BetSide === 1 ? 'X' : 'T';
export const sideName = (r) => r === 'T' ? 'Tài' : 'Xỉu';
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const toSeries = (list) => list.map(toResult);

// ================== FEATURE EXTRACTION (MỞ RỘNG) ==================
function detectPatterns(series) {
  const feats = {};
  const s = series.slice(0, 60);
  const n = s.length;
  const joined = s.join('');

  // ---- 1) Tần suất cơ bản ----
  const countT = s.filter(x => x === 'T').length;
  const countX = s.filter(x => x === 'X').length;
  feats.ratioT = countT / n;
  feats.ratioX = countX / n;

  // ---- 2) Streak ----
  let streak = 1;
  for (let i = 1; i < n; i++) {
    if (s[i] === s[0]) streak++; else break;
  }
  feats.streak = streak;
  feats.streakSide = s[0];

  // ---- 3) Runs analysis ----
  let runs = [], cur = 1;
  for (let i = 1; i < n; i++) {
    if (s[i] === s[i - 1]) cur++;
    else { runs.push(cur); cur = 1; }
  }
  runs.push(cur);
  feats.avgRun = runs.reduce((a, b) => a + b, 0) / runs.length;
  feats.maxRun = Math.max(...runs);
  feats.runs = runs;

  // ---- 4) Độ lệch chuẩn của runs ----
  const meanRun = feats.avgRun;
  feats.stdRun = Math.sqrt(runs.reduce((a, b) => a + (b - meanRun) ** 2, 0) / runs.length);

  // ---- 5) Cầu patterns ----
  feats.has11 = /(TT|XX){3,}/.test(joined);        // cầu 1-1
  feats.has22 = /(TT|XX){4,}/.test(joined);
  feats.has33 = /(TTT|XXX){2,}/.test(joined);
  feats.has121 = /TXXT|XTTX/.test(joined);
  feats.has212 = /TTXXTT|XXTTXX/.test(joined);
  feats.has1234 = /TXXXT|XTTTX/.test(joined);      // cầu gãy

  // ---- 6) Palindrome ----
  for (let len = 4; len <= 10; len += 2) {
    const palin = s.slice(0, len).join('');
    feats[`palindrome${len}`] = palin === palin.split('').reverse().join('');
  }

  // ---- 7) Markov bậc 1-10 ----
  for (let k = 1; k <= 10; k++) {
    const key = s.slice(0, k).join('');
    let t = 0, x = 0;
    for (let i = k; i < s.length; i++) {
      if (s.slice(i - k, i).join('') === key) {
        if (s[i] === 'T') t++; else x++;
      }
    }
    feats[`mk${k}`] = { key, t, x, total: t + x, bias: (t - x) / Math.max(1, t + x) };
  }

  // ---- 8) Gap (khoảng cách từ lần cuối xuất hiện) ----
  let lastT = -1, lastX = -1;
  for (let i = 0; i < n; i++) {
    if (s[i] === 'T' && lastT === -1) lastT = i;
    if (s[i] === 'X' && lastX === -1) lastX = i;
  }
  feats.gapT = lastT === -1 ? 99 : lastT;
  feats.gapX = lastX === -1 ? 99 : lastX;

  // ---- 9) Alternating ----
  let altCount = 0;
  for (let i = 1; i < n; i++) if (s[i] !== s[i - 1]) altCount++;
  feats.altRatio = altCount / (n - 1);
  feats.alternating = feats.altRatio > 0.65;

  // ---- 10) Xu hướng (momentum) ----
  const recent10 = s.slice(0, 10);
  const older10 = s.slice(10, 20);
  feats.momentumT = (recent10.filter(x => x === 'T').length / 10) -
                    (older10.filter(x => x === 'T').length / 10);

  // ---- 11) Fibonacci / Golden Ratio positions ----
  const fibs = [1, 2, 3, 5, 8, 13, 21];
  feats.fibAlignedT = fibs.filter(f => s[f] === 'T').length / fibs.length;

  // ---- 12) Reversal points (điểm đảo) ----
  let reversals = 0;
  for (let i = 1; i < n - 1; i++) {
    if (s[i] !== s[i - 1] && s[i] !== s[i + 1]) reversals++;
  }
  feats.reversalRate = reversals / (n - 2);

  // ---- 13) Chu kỳ trung bình ----
  let cycleDiffs = [];
  let lastTIdx = -1;
  for (let i = 0; i < n; i++) {
    if (s[i] === 'T') {
      if (lastTIdx !== -1) cycleDiffs.push(i - lastTIdx);
      lastTIdx = i;
    }
  }
  feats.avgCycleT = cycleDiffs.length > 0
    ? cycleDiffs.reduce((a, b) => a + b, 0) / cycleDiffs.length : 2;

  // ---- 14) Entropy (độ ngẫu nhiên) ----
  const pT = feats.ratioT, pX = feats.ratioX;
  feats.entropy = -(pT * Math.log2(pT || 0.0001) + pX * Math.log2(pX || 0.0001));

  // ---- 15) N-gram window count (2-8) ----
  for (let ng = 2; ng <= 8; ng++) {
    const key = s.slice(0, ng).join('');
    let t = 0, x = 0;
    for (let i = ng; i < s.length; i++) {
      if (s.slice(i - ng, i).join('') === key) {
        if (s[i] === 'T') t++; else x++;
      }
    }
    feats[`ngram${ng}`] = { key, t, x, total: t + x };
  }

  // ---- 16) Pattern symmetry (nửa đầu vs nửa sau) ----
  const half = Math.floor(n / 2);
  const firstHalf = s.slice(0, half).join('');
  const secondHalf = s.slice(half, half * 2).join('');
  let same = 0;
  for (let i = 0; i < Math.min(firstHalf.length, secondHalf.length); i++) {
    if (firstHalf[i] === secondHalf[i]) same++;
  }
  feats.symmetryScore = same / Math.min(firstHalf.length, secondHalf.length);

  // ---- 17) Position bias (vị trí nào hay ra T/X) ----
  let evenT = 0, evenTotal = 0;
  for (let i = 0; i < n; i += 2) { if (s[i] === 'T') evenT++; evenTotal++; }
  feats.evenBiasT = evenTotal > 0 ? evenT / evenTotal : 0.5;

  return feats;
}

// ============================================================================
//                           12 ENGINES DỰ ĐOÁN
// ============================================================================

/**
 * ENGINE 1 — MARKOV CHAIN (bậc 1-10, weighted)
 */
function engineMarkov(feats, series) {
  const score = { T: 0, X: 0 };
  for (let k = 1; k <= 10; k++) {
    const m = feats[`mk${k}`];
    if (!m || m.total < 2) continue;
    const w = Math.pow(1.4, 10 - k) * (m.total / (m.total + 2)); // Laplace smoothing
    const biasT = (m.t + 0.5) / (m.total + 1);
    const biasX = (m.x + 0.5) / (m.total + 1);
    score.T += biasT * w;
    score.X += biasX * w;
  }
  return score;
}

/**
 * ENGINE 2 — STREAK ANALYZER (bệt/gãy/đảo)
 */
function engineStreak(feats, series) {
  const score = { T: 0, X: 0 };
  const side = feats.streakSide;
  const opp = side === 'T' ? 'X' : 'T';
  const st = feats.streak;
  const avg = feats.avgRun;
  const std = feats.stdRun;

  // Streak đang dài hơn trung bình đáng kể → khả năng bẻ cao
  if (st > avg + std) {
    score[opp] += 1.5 + (st - avg) * 0.5;
  } else if (st >= avg - 0.5 && st <= avg + 0.5) {
    // Đang trong vùng trung bình → 50/50 nhưng nghiêng nhẹ về bẻ
    score[opp] += 0.3;
    score[side] += 0.2;
  } else if (st < avg) {
    // Streak ngắn → khả năng tiếp tục
    score[side] += 0.8;
  }

  // Streak rất dài (>=6) → hầu như chắc chắn bẻ sớm
  if (st >= 6) score[opp] += 1.0;
  if (st >= 8) score[opp] += 1.5;

  // Max run đã bị chạm → khả năng bẻ
  if (st >= feats.maxRun && st >= 3) score[opp] += 0.7;

  return score;
}

/**
 * ENGINE 3 — FREQUENCY / MEAN REVERSION
 */
function engineFrequency(feats, series) {
  const score = { T: 0, X: 0 };
  const devT = feats.ratioT - 0.5;

  // Nếu T xuất hiện quá nhiều → nghiêng về X (mean reversion)
  score['T'] -= devT * 2.5;
  score['X'] += devT * 2.5;

  // Nếu lệch cực mạnh (>70%) → đảo mạnh
  if (feats.ratioT > 0.7) score['X'] += 1.5;
  if (feats.ratioX > 0.7) score['T'] += 1.5;

  // Gap: 1 bên lâu chưa xuất hiện → khả năng xuất hiện
  if (feats.gapT >= 4) score['T'] += feats.gapT * 0.15;
  if (feats.gapX >= 4) score['X'] += feats.gapX * 0.15;

  return score;
}

/**
 * ENGINE 4 — PATTERN MINER (cầu cổ điển)
 */
function enginePatternMiner(feats, series) {
  const score = { T: 0, X: 0 };
  const s = series.slice(0, 12).join('');

  // Cầu 1-1 (alternating)
  if (feats.alternating) {
    const next = series[0] === 'T' ? 'X' : 'T';
    score[next] += 2.0;
  }

  // Cầu 2-2
  if (/(TT|XX){3,}$/.test(s)) {
    const last = series[0];
    // đang ở cuối nhịp 2 → bẻ
    if (s.slice(0, 2) === last + last && s[2] !== last) {
      score[last === 'T' ? 'X' : 'T'] += 1.0;
    } else {
      score[last] += 0.6;
    }
  }

  // Cầu 3-3
  if (/(TTT|XXX){2,}$/.test(s)) {
    const last = series[0];
    if (s.slice(0, 3) === last.repeat(3) && s[3] !== last) {
      score[last === 'T' ? 'X' : 'T'] += 1.2;
    }
  }

  // Cầu 1-2-1
  if (feats.has121) {
    const sub = series.slice(0, 4).join('');
    if (sub === 'TXXT') score['X'] += 1.0;
    if (sub === 'XTTX') score['T'] += 1.0;
  }

  // Cầu 2-1-2
  if (feats.has212) {
    const sub = series.slice(0, 6).join('');
    if (sub === 'TTXXTT') score['X'] += 0.8;
    if (sub === 'XXTTXX') score['T'] += 0.8;
  }

  // Palindrome
  for (let len = 4; len <= 10; len += 2) {
    if (feats[`palindrome${len}`]) {
      score[series[len - 1]] += 1.5;
    }
  }

  return score;
}

/**
 * ENGINE 5 — N-GRAM PREDICTOR (2-8 gram weighted)
 */
function engineNGram(feats, series) {
  const score = { T: 0, X: 0 };
  for (let ng = 2; ng <= 8; ng++) {
    const g = feats[`ngram${ng}`];
    if (!g || g.total < 2) continue;
    const w = Math.pow(1.5, ng - 2) * (g.total / (g.total + 3));
    score.T += (g.t + 0.5) * w;
    score.X += (g.x + 0.5) * w;
  }
  return score;
}

/**
 * ENGINE 6 — FIBONACCI / GOLDEN CYCLE
 */
function engineFibonacci(feats, series) {
  const score = { T: 0, X: 0 };
  const s = series.slice(0, 30);

  // Fibonacci positions
  const fibs = [1, 2, 3, 5, 8, 13, 21];
  let fibT = 0, fibX = 0;
  for (const f of fibs) {
    if (s[f] === 'T') fibT++; else fibX++;
  }
  if (fibX > fibT) score['T'] += 0.8;  // nếu vị trí fib ra X nhiều → khả năng ra T
  if (fibT > fibX) score['X'] += 0.8;

  // Golden ratio cycle ~1.618
  const cycle = feats.avgCycleT;
  if (Math.abs(cycle - 1.618) < 0.3) score['T'] += 0.5;

  return score;
}

/**
 * ENGINE 7 — BAYESIAN INFERENCE
 */
function engineBayesian(feats, series) {
  const score = { T: 0, X: 0 };

  // Prior
  let pT = 0.5, pX = 0.5;

  // Likelihood từ Markov bậc cao
  const m = feats.mk4;
  if (m && m.total >= 3) {
    const likeT = (m.t + 1) / (m.total + 2);
    const likeX = (m.x + 1) / (m.total + 2);
    pT *= likeT * 2;
    pX *= likeX * 2;
  }

  // Likelihood từ streak
  if (feats.streak >= 4) {
    const opp = feats.streakSide === 'T' ? 'X' : 'T';
    if (opp === 'T') pT *= 1.3; else pX *= 1.3;
  }

  // Normalize
  const sum = pT + pX;
  pT /= sum; pX /= sum;

  score.T = pT * 3;
  score.X = pX * 3;
  return score;
}

/**
 * ENGINE 8 — TIME-SERIES MOMENTUM
 */
function engineMomentum(feats, series) {
  const score = { T: 0, X: 0 };

  // Momentum dương → tiếp tục xu hướng
  if (feats.momentumT > 0.2) score['T'] += feats.momentumT * 2;
  if (feats.momentumT < -0.2) score['X'] += Math.abs(feats.momentumT) * 2;

  // Đảo chiều khi momentum đạt đỉnh
  if (feats.momentumT > 0.5) score['X'] += 0.5;
  if (feats.momentumT < -0.5) score['T'] += 0.5;

  return score;
}

/**
 * ENGINE 9 — SYMMETRY / PALINDROME
 */
function engineSymmetry(feats, series) {
  const score = { T: 0, X: 0 };

  if (feats.symmetryScore > 0.6) {
    // Có xu hướng lặp lại → dự đoán theo ký tự tương ứng
    const half = Math.floor(series.length / 2);
    if (series[0] === series[half]) score[series[0]] += 0.8;
  }

  // Palindromes ngắn
  for (let len = 4; len <= 8; len += 2) {
    if (feats[`palindrome${len}`]) {
      score[series[len - 1]] += 1.0;
    }
  }

  return score;
}

/**
 * ENGINE 10 — NEURAL WEIGHTED SUM (mô phỏng 1 lớp ẩn)
 */
function engineNeural(feats, series) {
  // Trọng số "đã học" (thực nghiệm)
  const W = {
    ratioT: -1.5,
    streak: -0.3,
    avgRun: -0.4,
    momentumT: 1.2,
    reversalRate: -0.8,
    entropy: -0.5,
    symmetryScore: 0.6,
    evenBiasT: 0.4,
  };

  let sum = 0;
  for (const [k, w] of Object.entries(W)) {
    sum += (feats[k] - 0.5) * w;
  }

  // ReLU + sigmoid
  const sig = 1 / (1 + Math.exp(-sum * 2));
  return {
    T: sig * 3,
    X: (1 - sig) * 3,
  };
}

/**
 * ENGINE 11 — REVERSE PSYCHOLOGY (đám đông ngược)
 */
function engineReverse(feats, series) {
  // Nếu kết quả gần đây quá "đẹp" cho 1 phía → nhà cái có thể đảo
  const score = { T: 0, X: 0 };
  const recent = series.slice(0, 8);
  const tCount = recent.filter(x => x === 'T').length;

  // Nếu 6/8 phiên gần nhất là T → nghi ngờ đảo sang X
  if (tCount >= 6) score['X'] += 1.0;
  if (tCount <= 2) score['T'] += 1.0;

  // Nếu đang có chuỗi thắng dài (bot đúng liên tiếp) → có thể sắp gãy
  // (dùng để giảm confidence, không phải đảo predict)

  return score;
}

/**
 * ENGINE 12 — DEEP PATTERN TREE (đệ quy depth 10)
 */
function engineDeepTree(feats, series) {
  const score = { T: 0, X: 0 };

  // Đệ quy tìm pattern lặp lại sâu
  function searchMatch(depth) {
    if (depth < 1) return null;
    const key = series.slice(0, depth).join('');
    let t = 0, x = 0;
    for (let i = depth; i < series.length; i++) {
      if (series.slice(i - depth, i).join('') === key) {
        if (series[i] === 'T') t++; else x++;
      }
    }
    if (t + x >= 2) {
      return { t, x, total: t + x, depth };
    }
    return searchMatch(depth - 1);
  }

  const match = searchMatch(10);
  if (match) {
    const w = match.depth * 0.5 * (match.total / (match.total + 2));
    score.T += (match.t / match.total) * w;
    score.X += (match.x / match.total) * w;
  }

  return score;
}

// ============================================================================
//                    ENSEMBLE — KẾT HỢP 12 ENGINES
// ============================================================================

const ENGINES = [
  { name: 'markov',   fn: engineMarkov,       defaultWeight: 1.5 },
  { name: 'streak',   fn: engineStreak,       defaultWeight: 1.3 },
  { name: 'frequency',fn: engineFrequency,    defaultWeight: 1.0 },
  { name: 'pattern',  fn: enginePatternMiner, defaultWeight: 1.4 },
  { name: 'ngram',    fn: engineNGram,        defaultWeight: 1.4 },
  { name: 'fibonacci',fn: engineFibonacci,    defaultWeight: 0.6 },
  { name: 'bayesian', fn: engineBayesian,     defaultWeight: 1.2 },
  { name: 'momentum', fn: engineMomentum,     defaultWeight: 0.9 },
  { name: 'symmetry', fn: engineSymmetry,     defaultWeight: 0.8 },
  { name: 'neural',   fn: engineNeural,       defaultWeight: 1.1 },
  { name: 'reverse',  fn: engineReverse,      defaultWeight: 0.5 },
  { name: 'deeptree', fn: engineDeepTree,     defaultWeight: 1.3 },
];

/**
 * Ensemble — Voting + Adaptive Weights
 */
function ensemblePredict(feats, series, gameKey) {
  const mem = memory[gameKey];
  const engineScores = {};
  const votes = { T: 0, X: 0 };

  for (const eng of ENGINES) {
    const s = eng.fn(feats, series);
    engineScores[eng.name] = s;

    // Lấy weight từ memory nếu có, ngược lại dùng default
    const learnedW = mem.engineWeights.get(eng.name);
    const w = learnedW !== undefined
      ? (learnedW * 0.7 + eng.defaultWeight * 0.3)
      : eng.defaultWeight;

    // Vote theo hướng engine nghiêng
    const total = s.T + s.X;
    if (total > 0) {
      const tRatio = s.T / total;
      votes.T += tRatio * w;
      votes.X += (1 - tRatio) * w;
    }
  }

  // Final
  const predictSide = votes.T >= votes.X ? 'T' : 'X';
  const totalVote = votes.T + votes.X;
  const rawConf = Math.abs(votes.T - votes.X) / (totalVote || 1);

  // Calibrate confidence bằng entropy + số phiên
  const entropyFactor = 1 - (feats.entropy / 1.2);
  const sampleFactor = Math.min(1, series.length / 40);
  const confidence = clamp(rawConf * 0.6 + entropyFactor * 0.25 + sampleFactor * 0.15, 0, 0.98);

  return {
    predictSide,
    predictName: sideName(predictSide),
    votes,
    engineScores,
    confidence: Math.round(confidence * 10000) / 100,
  };
}

// ============================================================================
//                     LEARNING — CẬP NHẬT WEIGHT THEO KẾT QUẢ
// ============================================================================

/**
 * Khi có kết quả phiên mới, cập nhật trọng số của từng engine
 * Engine nào dự đoán đúng → tăng weight, sai → giảm
 */
export function updateEngineWeights(gameKey, list) {
  const mem = memory[gameKey];
  const series = toSeries(list);

  // Cửa sổ backtest 30 phiên
  const window = 30;
  const engineHits = new Map();
  const engineTotals = new Map();

  for (let i = 5; i < Math.min(window, series.length - 1); i++) {
    const sub = series.slice(i);
    const feats = detectPatterns(sub);

    for (const eng of ENGINES) {
      const s = eng.fn(feats, series.slice(i));
      const total = s.T + s.X;
      if (total === 0) continue;
      const pred = s.T >= s.X ? 'T' : 'X';
      const actual = series[i - 1];

      if (!engineHits.has(eng.name)) { engineHits.set(eng.name, 0); engineTotals.set(eng.name, 0); }
      engineTotals.set(eng.name, engineTotals.get(eng.name) + 1);
      if (pred === actual) engineHits.set(eng.name, engineHits.get(eng.name) + 1);
    }
  }

  // Cập nhật weight với learning rate
  for (const eng of ENGINES) {
    const total = engineTotals.get(eng.name) || 0;
    if (total < 5) continue;
    const acc = engineHits.get(eng.name) / total;
    const targetW = eng.defaultWeight * (0.4 + acc * 1.2); // acc=0.5 → ~1.0x, acc=0.7 → ~1.24x
    const oldW = mem.engineWeights.get(eng.name) ?? eng.defaultWeight;
    const newW = oldW * 0.85 + targetW * 0.15; // EMA
    mem.engineWeights.set(eng.name, clamp(newW, 0.2, 3.0));

    // Lưu engine stats
    mem.engineStats.set(eng.name, {
      hits: engineHits.get(eng.name) || 0,
      total,
      acc: acc.toFixed(3),
    });
  }
}

// ============================================================================
//                    LEARN PATTERN (như cũ nhưng mở rộng)
// ============================================================================
function learnFromHistory(gameKey, list) {
  const series = toSeries(list);
  const mem = memory[gameKey];

  for (let i = 5; i < series.length - 1; i++) {
    const sub = series.slice(i);
    const feats = detectPatterns(sub);

    // Key nhiều chiều: markov2 + streak + alternating + ngram4
    const key = [
      feats.mk2.key,
      feats.streak,
      feats.streakSide,
      feats.alternating ? 'A' : 'N',
      feats.ngram4.key,
    ].join('|');

    const ens = ensemblePredict(feats, sub, gameKey);
    const actual = series[i - 1];

    if (!mem.patterns.has(key)) mem.patterns.set(key, { correct: 0, wrong: 0 });
    const e = mem.patterns.get(key);
    if (ens.predictSide === actual) e.correct++; else e.wrong++;
  }
}

// ============================================================================
//                    PREDICT CHÍNH
// ============================================================================
export function predict(gameKey, list) {
  const series = toSeries(list);
  const feats = detectPatterns(series);

  // Ensemble
  const ens = ensemblePredict(feats, series, gameKey);

  // Điều chỉnh bởi pattern memory
  const mem = memory[gameKey];
  const key = [
    feats.mk2.key,
    feats.streak,
    feats.streakSide,
    feats.alternating ? 'A' : 'N',
    feats.ngram4.key,
  ].join('|');

  let patternBoost = 0;
  if (mem.patterns.has(key)) {
    const p = mem.patterns.get(key);
    const total = p.correct + p.wrong;
    if (total >= 3) {
      const acc = p.correct / total;
      if (acc > 0.6) patternBoost = 0.15 * (acc - 0.5) * 2;
      else if (acc < 0.4) patternBoost = -0.15 * (0.5 - acc) * 2;
    }
  }

  let confidence = clamp(ens.confidence / 100 + patternBoost, 0, 0.98);

  return {
    predictSide: ens.predictSide,
    predictName: ens.predictName,
    votes: ens.votes,
    engineScores: ens.engineScores,
    features: feats,
    confidence: Math.round(confidence * 10000) / 100,
  };
}

// ============================================================================
//                    FETCH + PIPELINE
// ============================================================================
export async function getPrediction(gameKey) {
  const r = await fetch(GAMES[gameKey].api, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const list = await r.json();
  if (!Array.isArray(list) || list.length === 0) throw new Error('Không lấy được dữ liệu');

  // Pipeline học
  learnFromHistory(gameKey, list);
  updateEngineWeights(gameKey, list);

  const result = predict(gameKey, list);
  const latest = list[0];
  const nextSession = latest.SessionId + 1;

  // Cập nhật history + stats
  const mem = memory[gameKey];
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
    if (mem.history.length > 1000) mem.history.pop();
  }

  saveMemory();

  // Thông tin engine weights
  const engineInfo = ENGINES.map(e => {
    const w = mem.engineWeights.get(e.name) ?? e.defaultWeight;
    const s = mem.engineStats.get(e.name);
    return {
      name: e.name,
      weight: Math.round(w * 1000) / 1000,
      acc: s ? s.acc : null,
      hits: s ? s.hits : 0,
      total: s ? s.total : 0,
    };
  });

  return {
    game: GAMES[gameKey].name,
    gameKey,
    session: latest.SessionId,
    nextSession,
    lastResult: toResult(latest),
    lastResultName: sideName(toResult(latest)),
    lastDice: [latest.FirstDice, latest.SecondDice, latest.ThirdDice],
    lastSum: latest.DiceSum,
    predictSide: result.predictSide,
    predict: result.predictName,
    confidence: result.confidence,
    votes: result.votes,
    engineScores: result.engineScores,
    engines: engineInfo,
    features: {
      streak: result.features.streak,
      streakSide: result.features.streakSide,
      ratioT: result.features.ratioT.toFixed(3),
      ratioX: result.features.ratioX.toFixed(3),
      avgRun: result.features.avgRun.toFixed(2),
      maxRun: result.features.maxRun,
      stdRun: result.features.stdRun.toFixed(2),
      alternating: result.features.alternating,
      altRatio: result.features.altRatio.toFixed(3),
      entropy: result.features.entropy.toFixed(3),
      momentumT: result.features.momentumT.toFixed(3),
      reversalRate: result.features.reversalRate.toFixed(3),
      avgCycleT: result.features.avgCycleT.toFixed(2),
      symmetryScore: result.features.symmetryScore.toFixed(3),
    },
    stats: memory[gameKey].stats,
    patternCount: memory[gameKey].patterns.size,
    history: list.slice(0, 30).map(x => ({
      session: x.SessionId,
      dice: [x.FirstDice, x.SecondDice, x.ThirdDice],
      sum: x.DiceSum,
      result: toResult(x),
      resultName: sideName(toResult(x)),
      time: x.CreatedDate,
    })),
  };
}

// ============================================================================
//                    API ENDPOINTS
// ============================================================================
app.get('/api/predict/:game', async (req, res) => {
  const gameKey = req.params.game;
  if (!GAMES[gameKey]) return res.status(400).json({ error: 'Game không hợp lệ' });
  try { res.json(await getPrediction(gameKey)); }
  catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/history/:game', (req, res) => {
  const k = req.params.game;
  if (!GAMES[k]) return res.status(400).json({ error: 'Game không hợp lệ' });
  res.json({
    game: GAMES[k].name,
    stats: memory[k].stats,
    patternCount: memory[k].patterns.size,
    history: memory[k].history.slice(0, 100),
  });
});

app.get('/api/engines/:game', (req, res) => {
  const k = req.params.game;
  if (!GAMES[k]) return res.status(400).json({ error: 'Game không hợp lệ' });
  const mem = memory[k];
  const arr = ENGINES.map(e => ({
    name: e.name,
    defaultWeight: e.defaultWeight,
    learnedWeight: mem.engineWeights.get(e.name) ?? e.defaultWeight,
    stats: mem.engineStats.get(e.name) || { hits: 0, total: 0, acc: '0.000' },
  }));
  res.json({ game: GAMES[k].name, engines: arr });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server v3.0 tại http://localhost:${PORT}`));
