// filters.js — 사진 색 보정(필터)과 작은 스티커용 인쇄 보정
// 이름은 VSCO 방식을 따랐지만 값은 이 앱에서 직접 만든 근사치다(VSCO의 실제 프리셋 값이 아님).
//
// 값 설명 (모두 0이면 변화 없음)
//   gamma    중간 밝기 (1보다 작으면 밝게)
//   contrast 대비 (1 = 그대로)
//   sat      채도 (1 = 그대로, 0 = 흑백)
//   temp     색온도 (+ 따뜻하게, − 차갑게)
//   tint     초록(−)~자홍(+)
//   fade     검정을 들어 올려 바랜 느낌
//   matte    밝은 부분을 눌러 무광 느낌
//   shadow   그림자에 섞을 색 [r, g, b]
//   high     밝은 부분에 섞을 색 [r, g, b]
//   grain    필름 입자 (인쇄용 사진에만)
//   vignette 가장자리 어둡게 (인쇄용 사진에만)
//   posterize 색을 몇 단계로 끊기 (팝아트)
//   defaultAmount 처음 골랐을 때 강도 (없으면 100%)
//
// 필름 입자는 B1(흑백)에만 둔다. 작은 잉크젯 스티커에서 컬러 입자는 지저분한 얼룩처럼 찍히기 쉽다.

const FILTERS = [
  { id: 'none', name: '원본' },

  // A6 — 밝고 깨끗하게, 진한 색에 따뜻함을 더함. 일상·풍경·인물 두루.
  { id: 'A6', name: 'A6', gamma: 0.9, contrast: 1.04, sat: 1.06, temp: 0.15,
    high: [0.01, 0.005, -0.005], vignette: 0.06 },

  // C1 — 선명하고 화사한 색. 초록·빨강을 살리고 밝은 부분에 살짝 분홍빛. 꽃·자연·바다.
  //      (진한 빨강이 잉크젯에서 뭉개지지 않게 채도를 조금 덜 올렸다)
  { id: 'C1', name: 'C1', defaultAmount: 0.8, gamma: 0.96, contrast: 1.15, sat: 1.22, vib: 0.1, tint: 0.04,
    high: [0.02, 0, 0.015], hsl: [{ h: 110, w: 45, s: 0.2 }], vignette: 0.06 },

  // B1 — 고전적인 흑백, 대비 또렷하게, 아주 살짝 따뜻한 종이색.
  { id: 'B1', name: 'B1', gamma: 0.94, contrast: 1.2, sat: 0, fade: 0.02,
    high: [0.02, 0.012, -0.005], grain: 0.04, vignette: 0.1 },

  // Dog1 — 중간색을 살리고 튀는 색은 차분하게. 우아하고 고요한 클래식. 크림빛 하이라이트.
  //        (작은 스티커에서 흐리고 탁해 보이지 않게 차분하게 누르는 정도를 약 30% 줄이고 대비를 조금 올렸다)
  { id: 'Dog1', name: 'Dog1', gamma: 0.97, contrast: 1.0, sat: 0.9, vib: -0.38, temp: 0.05, tint: 0.03,
    fade: 0.04, matte: 0.02, shadow: [0.01, 0.005, 0], high: [0.025, 0.012, 0.01],
    vignette: 0.08 },

  // Pop — 색을 몇 단계로 뚝뚝 끊은 팝아트. 면이 단순하고 또렷해서 아주 작은 스티커에서도 눈에 띈다.
  { id: 'Pop', name: 'Pop', defaultAmount: 0.8, gamma: 0.95, contrast: 1.22, sat: 1.6, posterize: 4 },
];

// 작은 잉크젯 스티커용 인쇄 보정: 중간 밝기·그림자 들어 올림, 채도 조금 ↑, 윤곽 또렷하게
const PRINT_FIX = {
  gamma: 0.92, fade: 0.03, sat: 1.08,
  sharpen: 0.14,              // 선명도 세기
  sharpenMaxPx: 1000000,      // 이보다 큰 사진(예: 4×6 한 장)은 선명도 보정을 하지 않는다 — 작은 스티커용 보정이라서
};

// 인쇄 보정을 쓰는지 (설정 화면에서 끌 수 있음, 기본은 켜짐)
function printFixEnabled() {
  try { return localStorage.getItem(UI.printFixKey) !== '0'; } catch (e) { return true; }
}

function setPrintFixEnabled(on) {
  try { localStorage.setItem(UI.printFixKey, on ? '1' : '0'); } catch (e) { /* 저장 못 해도 무시 */ }
}

function findFilter(id) {
  return FILTERS.find((f) => f.id === id) || FILTERS[0];
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 색 보정 한 단계 (r, g, b: 0~1) → [r, g, b]
function grade(r, g, b, f) {
  if (f.gamma && f.gamma !== 1) {
    r = Math.pow(r, f.gamma); g = Math.pow(g, f.gamma); b = Math.pow(b, f.gamma);
  }
  if (f.temp) { r += f.temp * 0.08; b -= f.temp * 0.08; }
  if (f.tint) { g -= f.tint * 0.06; }
  if (f.contrast && f.contrast !== 1) {
    r = (r - 0.5) * f.contrast + 0.5; g = (g - 0.5) * f.contrast + 0.5; b = (b - 0.5) * f.contrast + 0.5;
  }
  let l = 0.299 * r + 0.587 * g + 0.114 * b;
  if (f.shadow || f.high) {
    const lc = clamp01(l);
    const ws = (1 - lc) * (1 - lc);
    const wh = lc * lc;
    if (f.shadow) { r += f.shadow[0] * ws; g += f.shadow[1] * ws; b += f.shadow[2] * ws; }
    if (f.high) { r += f.high[0] * wh; g += f.high[1] * wh; b += f.high[2] * wh; }
    l = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  if (f.sat !== undefined && f.sat !== 1) {
    r = l + (r - l) * f.sat; g = l + (g - l) * f.sat; b = l + (b - l) * f.sat;
  }
  if (f.vib) {
    // 생동감: 음수면 이미 진한 색일수록 더 차분하게 (중간색은 덜 건드림)
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = mx > 0 ? (mx - mn) / mx : 0;
    const k = Math.max(0, 1 + f.vib * s);
    r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k;
  }
  if (f.hsl) [r, g, b] = hueAdjust(r, g, b, f.hsl);
  if (f.fade || f.matte) {
    const lo = f.fade || 0;
    const span = 1 - lo - (f.matte || 0);
    r = lo + clamp01(r) * span; g = lo + clamp01(g) * span; b = lo + clamp01(b) * span;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

// ---------- 특정 색만 보정 (예: 노랑만 연하게, 초록만 갈색 쪽으로) ----------
// rules: [{ h: 중심 색상(도), w: 범위(도), s: 채도 변화(−1~+1), l: 밝기 변화, shift: 색상 이동(도) }]
function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(hk + 1 / 3), f(hk), f(hk - 1 / 3)];
}

function hueAdjust(r, g, b, rules) {
  let [h, s, l] = rgbToHsl(clamp01(r), clamp01(g), clamp01(b));
  if (s < 0.02) return [r, g, b];
  let dh = 0, ds = 0, dl = 0;
  for (const rule of rules) {
    let diff = Math.abs(h - rule.h) % 360;
    if (diff > 180) diff = 360 - diff;
    const wgt = Math.max(0, 1 - diff / rule.w);
    const smooth = wgt * wgt * (3 - 2 * wgt);
    dh += (rule.shift || 0) * smooth;
    ds += (rule.s || 0) * smooth;
    dl += (rule.l || 0) * smooth * s;   // 색이 진한 곳일수록 밝기 변화도 크게
  }
  return hslToRgb(h + dh, clamp01(s * (1 + ds)), clamp01(l + dl));
}

// ---------- 색 보정표 (속도용) ----------
// 픽셀마다 계산하면 느려서, 색 공간을 33×33×33 칸으로 나눠 미리 계산해 두고
// 그 사이 값은 주변 8칸을 섞어(삼선형 보간) 구한다.
const LUT_N = 33;
const LUT_LEN = LUT_N * LUT_N * LUT_N * 3;
const lutCache = new Map();
let blendBuf = null;   // 강도 조절 시 새 배열을 만들지 않고 재사용

// 필터 100% 기준(또는 원본)의 색 보정표만 한 번 만들어 보관한다
function fullTable(f, printFix) {
  const key = `${f ? f.id : 'none'}|${printFix ? 1 : 0}`;
  if (lutCache.has(key)) return lutCache.get(key);
  const N = LUT_N;
  const t = new Float32Array(LUT_LEN);
  let k = 0;
  for (let bi = 0; bi < N; bi++) {
    for (let gi = 0; gi < N; gi++) {
      for (let ri = 0; ri < N; ri++) {
        let r = ri / (N - 1), g = gi / (N - 1), b = bi / (N - 1);
        if (f) [r, g, b] = grade(r, g, b, f);
        if (printFix) [r, g, b] = grade(r, g, b, PRINT_FIX);
        t[k++] = r; t[k++] = g; t[k++] = b;
      }
    }
  }
  lutCache.set(key, t);
  return t;
}

// 강도(amount)가 바뀌어도 33³ 색 계산을 다시 하지 않고, 원본 표와 100% 표 사이만 비율로 섞는다
function colorTable(f, amount, printFix) {
  if (!f || amount <= 0) return fullTable(null, printFix);
  const t1 = fullTable(f, printFix);
  if (amount >= 1) return t1;
  const t0 = fullTable(null, printFix);
  if (!blendBuf) blendBuf = new Float32Array(LUT_LEN);
  for (let k = 0; k < LUT_LEN; k++) {
    blendBuf[k] = t0[k] + (t1[k] - t0[k]) * amount;
  }
  return blendBuf;
}

function lookup(t, R, G, B, out) {
  const N1 = LUT_N - 1;
  const fr = (R / 255) * N1, fg = (G / 255) * N1, fb = (B / 255) * N1;
  const r0 = fr | 0, g0 = fg | 0, b0 = fb | 0;
  const r1 = r0 < N1 ? r0 + 1 : r0, g1 = g0 < N1 ? g0 + 1 : g0, b1 = b0 < N1 ? b0 + 1 : b0;
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const N = LUT_N, NN = N * N;
  const i000 = (b0 * NN + g0 * N + r0) * 3, i100 = (b0 * NN + g0 * N + r1) * 3;
  const i010 = (b0 * NN + g1 * N + r0) * 3, i110 = (b0 * NN + g1 * N + r1) * 3;
  const i001 = (b1 * NN + g0 * N + r0) * 3, i101 = (b1 * NN + g0 * N + r1) * 3;
  const i011 = (b1 * NN + g1 * N + r0) * 3, i111 = (b1 * NN + g1 * N + r1) * 3;
  for (let c = 0; c < 3; c++) {
    const c00 = t[i000 + c] + (t[i100 + c] - t[i000 + c]) * dr;
    const c10 = t[i010 + c] + (t[i110 + c] - t[i010 + c]) * dr;
    const c01 = t[i001 + c] + (t[i101 + c] - t[i001 + c]) * dr;
    const c11 = t[i011 + c] + (t[i111 + c] - t[i011 + c]) * dr;
    const c0 = c00 + (c10 - c00) * dg;
    const c1 = c01 + (c11 - c01) * dg;
    out[c] = c0 + (c1 - c0) * db;
  }
}

// 간단한 난수 (같은 사진은 항상 같은 입자가 나오게)
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 윤곽 또렷하게: 위·아래·왼쪽·오른쪽 이웃과의 차이를 조금 더한다 (가벼운 선명도 보정)
function sharpen(data, w, h, amount) {
  const src = new Uint8ClampedArray(data);
  const row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    let i = y * row + 4;
    for (let x = 1; x < w - 1; x++, i += 4) {
      for (let c = 0; c < 3; c++) {
        const k = i + c;
        const v = src[k];
        data[k] = v + amount * (4 * v - src[k - 4] - src[k + 4] - src[k - row] - src[k + row]);
      }
    }
  }
}

// 사용자 수동 조정 항목 (VSCO 스타일: 자주 쓰는 5종 + 비네팅·그레인)
const ADJUSTMENTS = [
  { key: 'exp', name: '밝기',   icon: 'sun',      min: -50, max: 50 },
  { key: 'con', name: '대비',   icon: 'contrast', min: -50, max: 50 },
  { key: 'shd', name: '그림자', icon: 'shadow',   min: -50, max: 50 },
  { key: 'sat', name: '채도',   icon: 'droplet',  min: -50, max: 50 },
  { key: 'tmp', name: '색온도', icon: 'temp',     min: -50, max: 50 },
  { key: 'vig', name: '비네팅', icon: 'vignette', min: 0,   max: 100 },
  { key: 'grn', name: '그레인', icon: 'grain',    min: 0,   max: 100 },
];

function emptyAdj() {
  return { exp: 0, con: 0, shd: 0, sat: 0, tmp: 0, vig: 0, grn: 0 };
}

function hasAdjust(adj) {
  if (!adj) return false;
  return !!(adj.exp || adj.con || adj.shd || adj.sat || adj.tmp || adj.vig || adj.grn);
}

// 캔버스에 그려진 사진에 필터·수동 조정·인쇄 보정을 적용한다.
// look = { id, amount(0~1), adj? }, mode: 'print'(필터 입자·비네팅·선명도 포함) | 'preview'
function applyLook(ctx, w, h, look, printFix, mode) {
  const f = findFilter(look && look.id);
  const amount = look && look.amount !== undefined ? look.amount : 1;
  const adj = look && look.adj ? look.adj : null;
  const useFilter = f.id !== 'none' && amount > 0;
  const useAdj = hasAdjust(adj);
  if (!useFilter && !printFix && !useAdj) return;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const isPrint = mode === 'print';
  const rand = seededRandom(w * 7919 + h);
  const userGrain = adj && adj.grn ? (adj.grn / 100) * 0.16 : 0;
  const userVig = adj && adj.vig ? (adj.vig / 100) * 0.55 : 0;
  const grain = (isPrint && useFilter ? (f.grain || 0) * amount : 0) + userGrain;
  const vig = (isPrint && useFilter ? (f.vignette || 0) * amount : 0) + userVig;
  const cx = w / 2, cy = h / 2;
  const invMaxR2 = 1 / (cx * cx + cy * cy || 1);
  const useLut = useFilter || printFix;
  const lut = useLut ? colorTable(useFilter ? f : null, amount, printFix) : null;
  const N1 = LUT_N - 1, K = N1 / 255, NN = LUT_N * LUT_N, N3 = LUT_N * 3, NN3 = NN * 3;
  // 색 단계 나누기: 보정표는 경계를 부드럽게 섞으므로, 단계는 표를 거친 뒤 따로 끊는다
  const steps = useFilter && f.posterize ? f.posterize - 1 : 0;

  // 수동 색 조정 계수 (반복문 밖에서 한 번만 계산)
  const expMul = adj && adj.exp ? Math.pow(2, (adj.exp / 50) * 0.72) : 1;
  const shdAmt = adj && adj.shd ? (adj.shd / 50) * 0.34 : 0;
  const conFac = adj && adj.con ? 1 + (adj.con / 50) * 0.45 : 1;
  const tmpAmt = adj && adj.tmp ? (adj.tmp / 50) * 0.12 : 0;
  const satFac = adj && adj.sat ? 1 + (adj.sat / 50) * 0.75 : 1;

  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    const rowOff = y * w;
    for (let x = 0; x < w; x++) {
      const i = (rowOff + x) * 4;
      let r, g, b;
      if (useLut) {
        // 색 보정표에서 찾기 (r·g·b를 바로 풀어 계산해 반복문·배열 비용 제거)
        const fr = d[i] * K, fg = d[i + 1] * K, fb = d[i + 2] * K;
        const r0 = fr | 0, g0 = fg | 0, b0 = fb | 0;
        const dr = fr - r0, dg = fg - g0, db = fb - b0;
        const sr = r0 < N1 ? 3 : 0, sg = g0 < N1 ? N3 : 0, sb = b0 < N1 ? NN3 : 0;
        const p000 = (b0 * NN + g0 * LUT_N + r0) * 3;
        const p100 = p000 + sr, p010 = p000 + sg, p110 = p010 + sr;
        const p001 = p000 + sb, p101 = p001 + sr, p011 = p001 + sg, p111 = p011 + sr;

        const r00 = lut[p000] + (lut[p100] - lut[p000]) * dr;
        const r10 = lut[p010] + (lut[p110] - lut[p010]) * dr;
        const r01 = lut[p001] + (lut[p101] - lut[p001]) * dr;
        const r11 = lut[p011] + (lut[p111] - lut[p011]) * dr;
        const rc0 = r00 + (r10 - r00) * dg;
        r = rc0 + (r01 + (r11 - r01) * dg - rc0) * db;

        const g00 = lut[p000 + 1] + (lut[p100 + 1] - lut[p000 + 1]) * dr;
        const g10 = lut[p010 + 1] + (lut[p110 + 1] - lut[p010 + 1]) * dr;
        const g01 = lut[p001 + 1] + (lut[p101 + 1] - lut[p001 + 1]) * dr;
        const g11 = lut[p011 + 1] + (lut[p111 + 1] - lut[p011 + 1]) * dr;
        const gc0 = g00 + (g10 - g00) * dg;
        g = gc0 + (g01 + (g11 - g01) * dg - gc0) * db;

        const b00 = lut[p000 + 2] + (lut[p100 + 2] - lut[p000 + 2]) * dr;
        const b10 = lut[p010 + 2] + (lut[p110 + 2] - lut[p010 + 2]) * dr;
        const b01 = lut[p001 + 2] + (lut[p101 + 2] - lut[p001 + 2]) * dr;
        const b11 = lut[p011 + 2] + (lut[p111 + 2] - lut[p011 + 2]) * dr;
        const bc0 = b00 + (b10 - b00) * dg;
        b = bc0 + (b01 + (b11 - b01) * dg - bc0) * db;
      } else {
        r = d[i] / 255; g = d[i + 1] / 255; b = d[i + 2] / 255;
      }

      if (steps) {
        const pr = Math.round(r * steps) / steps, pg = Math.round(g * steps) / steps, pb = Math.round(b * steps) / steps;
        r += (pr - r) * amount; g += (pg - g) * amount; b += (pb - b) * amount;
      }
      if (expMul !== 1) { r *= expMul; g *= expMul; b *= expMul; }
      if (shdAmt) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        const lc = l < 0 ? 0 : l > 1 ? 1 : l;
        const ws = (1 - lc) * (1 - lc) * shdAmt;
        r += ws; g += ws; b += ws;
      }
      if (conFac !== 1) {
        r = (r - 0.5) * conFac + 0.5; g = (g - 0.5) * conFac + 0.5; b = (b - 0.5) * conFac + 0.5;
      }
      if (tmpAmt) { r += tmpAmt; b -= tmpAmt; }
      if (satFac !== 1) {
        const l2 = 0.299 * r + 0.587 * g + 0.114 * b;
        r = l2 + (r - l2) * satFac; g = l2 + (g - l2) * satFac; b = l2 + (b - l2) * satFac;
      }
      if (vig) {
        const dx = x - cx;
        const k = 1 - vig * (dx * dx + dy2) * invMaxR2;
        r *= k; g *= k; b *= k;
      }
      if (grain) {
        const n = (rand() - 0.5) * grain;
        r += n; g += n; b += n;
      }
      d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
    }
  }
  if (isPrint && printFix && w * h <= PRINT_FIX.sharpenMaxPx) sharpen(d, w, h, PRINT_FIX.sharpen);
  ctx.putImageData(img, 0, 0);
}
