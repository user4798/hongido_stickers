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

const FILTERS = [
  { id: 'none', name: '원본' },
  { id: 'A6', name: 'A6', gamma: 0.97, contrast: 0.9, sat: 0.9, temp: 0.35, fade: 0.06,
    shadow: [0.035, 0.015, -0.02], high: [0.03, 0.015, -0.025], grain: 0.035, vignette: 0.12 },
  { id: 'A7', name: 'A7', gamma: 0.88, contrast: 0.92, sat: 0.95, temp: 0.15, fade: 0.04, matte: 0.02,
    high: [0.02, 0.012, -0.01], grain: 0.025, vignette: 0.08 },
  { id: 'A8', name: 'A8', gamma: 0.95, contrast: 0.88, sat: 0.82, temp: -0.12, tint: -0.06, fade: 0.07,
    shadow: [-0.03, 0.03, 0.045], high: [0.01, 0.015, 0], grain: 0.03, vignette: 0.1 },
  { id: 'A9', name: 'A9', gamma: 0.96, contrast: 0.85, sat: 0.75, temp: 0.25, fade: 0.1, matte: 0.04,
    shadow: [0.02, 0.01, -0.01], high: [0.05, 0.04, -0.05], grain: 0.05, vignette: 0.15 },
  { id: 'C1', name: 'C1', gamma: 0.97, contrast: 1.2, sat: 1.35, temp: 0.05, vignette: 0.08 },
  { id: 'B1', name: 'B1', gamma: 0.95, contrast: 1.22, sat: 0, fade: 0.03,
    high: [0.02, 0.012, -0.005], grain: 0.04, vignette: 0.12 },
];

// 작은 잉크젯 스티커용 인쇄 보정: 중간 밝기·그림자 들어 올림, 채도 조금 ↑, 윤곽 또렷하게
const PRINT_FIX = { gamma: 0.92, fade: 0.03, sat: 1.08, sharpen: 0.55 };

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
  if (f.fade || f.matte) {
    const lo = f.fade || 0;
    const span = 1 - lo - (f.matte || 0);
    r = lo + clamp01(r) * span; g = lo + clamp01(g) * span; b = lo + clamp01(b) * span;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

// ---------- 색 보정표 (속도용) ----------
// 픽셀마다 계산하면 느려서, 색 공간을 33×33×33 칸으로 나눠 미리 계산해 두고
// 그 사이 값은 주변 8칸을 섞어(삼선형 보간) 구한다.
const LUT_N = 33;
const lutCache = new Map();

function colorTable(f, amount, printFix) {
  const key = `${f ? f.id : 'none'}|${amount.toFixed(2)}|${printFix ? 1 : 0}`;
  if (lutCache.has(key)) return lutCache.get(key);
  const N = LUT_N;
  const t = new Float32Array(N * N * N * 3);
  let k = 0;
  for (let bi = 0; bi < N; bi++) {
    for (let gi = 0; gi < N; gi++) {
      for (let ri = 0; ri < N; ri++) {
        let r = ri / (N - 1), g = gi / (N - 1), b = bi / (N - 1);
        if (f) {
          const [fr, fg, fb] = grade(r, g, b, f);
          r += (fr - r) * amount; g += (fg - g) * amount; b += (fb - b) * amount;
        }
        if (printFix) [r, g, b] = grade(r, g, b, PRINT_FIX);
        t[k++] = r; t[k++] = g; t[k++] = b;
      }
    }
  }
  if (lutCache.size > 40) lutCache.clear();
  lutCache.set(key, t);
  return t;
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

// 윤곽 또렷하게 (언샤프 마스크, 3×3 흐림 기준)
function sharpen(data, w, h, amount) {
  const src = new Uint8ClampedArray(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) sum += src[i + (dy * w + dx) * 4 + c];
        }
        const blur = sum / 9;
        data[i + c] = src[i + c] + (src[i + c] - blur) * amount;
      }
    }
  }
}

// 캔버스에 그려진 사진에 필터·인쇄 보정을 적용한다.
// look = { id, amount(0~1) }, mode: 'print'(입자·비네팅·선명도 포함) | 'preview'(색만)
function applyLook(ctx, w, h, look, printFix, mode) {
  const f = findFilter(look && look.id);
  const amount = look && look.amount !== undefined ? look.amount : 1;
  const useFilter = f.id !== 'none' && amount > 0;
  if (!useFilter && !printFix) return;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const isPrint = mode === 'print';
  const rand = seededRandom(w * 7919 + h);
  const grain = isPrint && useFilter ? (f.grain || 0) * amount : 0;
  const vig = isPrint && useFilter ? (f.vignette || 0) * amount : 0;
  const cx = w / 2, cy = h / 2;
  const maxR = Math.hypot(cx, cy);
  const lut = colorTable(useFilter ? f : null, amount, printFix);
  const out = [0, 0, 0];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      lookup(lut, d[i], d[i + 1], d[i + 2], out);
      let r = out[0], g = out[1], b = out[2];
      if (vig) {
        const t = Math.hypot(x - cx, y - cy) / maxR;
        const k = 1 - vig * t * t;
        r *= k; g *= k; b *= k;
      }
      if (grain) {
        const n = (rand() - 0.5) * grain;
        r += n; g += n; b += n;
      }
      d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
    }
  }
  if (isPrint && printFix) sharpen(d, w, h, PRINT_FIX.sharpen);
  ctx.putImageData(img, 0, 0);
}
