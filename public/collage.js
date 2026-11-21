// collage.js — 4×6 매거진 콜라주 전용 (EXIF 날짜 추출, 사진 톤 자동 배경색, 300dpi 한 장 합성 PDF)
// 외부 라이브러리 없이 브라우저 기본 기능만 사용한다.

const COLLAGE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

const COLLAGE_TONES = [
  { id: 'auto',     name: '자동',    bg: '#E9E8E5', fg: '#1A1A1C' },
  { id: 'silver',   name: '실버',    bg: '#E7E7E5', fg: '#1A1A1C' },
  { id: 'cream',    name: '웜 크림', bg: '#EFEBE4', fg: '#1E1B18' },
  { id: 'white',    name: '화이트',  bg: '#F7F7F5', fg: '#18181A' },
  { id: 'charcoal', name: '차콜',    bg: '#1E1E21', fg: '#F0EFEA' },
];

function defaultCollageState(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const mon = COLLAGE_MONTHS[m] || 'Nov';
  return {
    tone: 'auto',
    year: String(y),
    monthText: `(${mon})`,
    lines: [`${mon}. ${y}`, 'Hongido', 'Five Frames'],
    dateEdited: false,
    line0Edited: false,
  };
}

function yearHalves(yearStr) {
  const digits = String(yearStr || '').replace(/\D/g, '');
  if (digits.length >= 4) return [`(${digits.slice(0, 2)})`, `(${digits.slice(2, 4)})`];
  if (digits.length > 0) return [`(${digits})`, ''];
  return ['', ''];
}

// ---------- 첫 번째 사진 EXIF 촬영 날짜 추출 ----------

function parseExifDateText(str) {
  const m = /(\d{4}):(\d{2}):(\d{2})/.exec(str);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

function readAscii(view, offset, len) {
  let s = '';
  const end = Math.min(view.byteLength, offset + len);
  for (let i = offset; i < end; i++) {
    const ch = view.getUint8(i);
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s;
}

function parseJpegExifDate(view) {
  if (view.byteLength < 12 || view.getUint16(0, false) !== 0xFFD8) return null;
  let pos = 2;
  while (pos + 4 < view.byteLength) {
    if (view.getUint8(pos) !== 0xFF) break;
    const marker = view.getUint8(pos + 1);
    if (marker === 0xDA || marker === 0xD9) break;
    const size = view.getUint16(pos + 2, false);
    if (marker === 0xE1 && pos + 10 < view.byteLength && readAscii(view, pos + 4, 4) === 'Exif') {
      const tiff = pos + 10;
      if (tiff + 8 > view.byteLength) return null;
      const le = view.getUint16(tiff, false) === 0x4949;
      if (view.getUint16(tiff + 2, le) !== 42) return null;
      const ifd0 = tiff + view.getUint32(tiff + 4, le);
      const readTagString = (ifdOffset, targetTags) => {
        if (ifdOffset + 2 > view.byteLength) return null;
        const count = view.getUint16(ifdOffset, le);
        let subIfd = 0;
        const found = {};
        for (let i = 0; i < count; i++) {
          const entry = ifdOffset + 2 + i * 12;
          if (entry + 12 > view.byteLength) break;
          const tag = view.getUint16(entry, le);
          const cnt = view.getUint32(entry + 4, le);
          if (tag === 0x8769) {
            subIfd = tiff + view.getUint32(entry + 8, le);
          } else if (targetTags.includes(tag) && cnt >= 10 && cnt <= 32) {
            const valOff = cnt <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, le);
            const dt = parseExifDateText(readAscii(view, valOff, cnt));
            if (dt) found[tag] = dt;
          }
        }
        return { found, subIfd };
      };
      const r0 = readTagString(ifd0, [0x0132]);
      if (r0 && r0.subIfd) {
        const r1 = readTagString(r0.subIfd, [0x9003, 0x9004]);
        if (r1 && r1.found[0x9003]) return r1.found[0x9003];
        if (r1 && r1.found[0x9004]) return r1.found[0x9004];
      }
      if (r0 && r0.found[0x0132]) return r0.found[0x0132];
      return null;
    }
    if (size < 2) break;
    pos += 2 + size;
  }
  return null;
}

// HEIC 등 비-JPEG 메타데이터 안의 YYYY:MM:DD HH:MM:SS 패턴 보조 탐색
function scanAsciiExifDate(bytes) {
  const n = bytes.length;
  for (let i = 0; i + 19 <= n; i++) {
    if (
      bytes[i] === 50 && bytes[i + 1] === 48 &&     // '20'
      bytes[i + 4] === 58 && bytes[i + 7] === 58 && // ':' ':'
      bytes[i + 10] === 32 && bytes[i + 13] === 58  // ' ' ':'
    ) {
      let s = '';
      for (let k = 0; k < 19; k++) s += String.fromCharCode(bytes[i + k]);
      const dt = parseExifDateText(s);
      if (dt) return dt;
    }
  }
  return null;
}

async function readPhotoDate(file) {
  if (file && file.slice) {
    try {
      const buf = await file.slice(0, 131072).arrayBuffer();
      const view = new DataView(buf);
      const dt = parseJpegExifDate(view) || scanAsciiExifDate(new Uint8Array(buf));
      if (dt) return dt;
    } catch (e) { /* 못 읽으면 파일 날짜로 */ }
  }
  if (file && file.lastModified) return new Date(file.lastModified);
  return new Date();
}

// ---------- 사진 전체와 어울리는 배경색 자동 추출 ----------

function toHex2(v) {
  return Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
}

function extractPaperTone(cells) {
  const filled = (cells || []).filter((c) => c && c.preview);
  if (!filled.length) return '#E9E8E5';
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 24;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  let rSum = 0, gSum = 0, bSum = 0, wSum = 0;

  filled.forEach((entry) => {
    ctx.clearRect(0, 0, 24, 24);
    ctx.drawImage(entry.preview, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = (mx + mn) / 2;
      // 너무 어둡거나(그림자) 너무 밝은(흰빛) 픽셀은 제외하고 사진의 본래 색감을 모은다
      if (l < 0.12 || l > 0.92) continue;
      const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
      const weight = 0.35 + sat;
      rSum += r * weight;
      gSum += g * weight;
      bSum += b * weight;
      wSum += weight;
    }
  });
  freeCanvas(c);

  if (wSum <= 0) return '#E9E8E5';
  const [h, s] = rgbToHsl(rSum / wSum, gSum / wSum, bSum / wSum);
  // 잡지 종이 느낌: 사진의 색상은 살리되, 채도는 아주 낮고 밝기는 90.5%로 차분하게
  const paperS = s < 0.05 ? 0.02 : Math.min(0.13, Math.max(0.035, s * 0.28));
  const [pr, pg, pb] = hslToRgb(h, paperS, 0.905);
  return `#${toHex2(pr)}${toHex2(pg)}${toHex2(pb)}`;
}

function resolveCollageTheme(cells, toneId) {
  if (toneId && toneId !== 'auto') {
    const hit = COLLAGE_TONES.find((t) => t.id === toneId);
    if (hit) return { bg: hit.bg, fg: hit.fg };
  }
  return { bg: extractPaperTone(cells), fg: '#1A1A1C' };
}

// ---------- 300dpi 매거진 한 장 합성 PDF ----------

function slotRadiiMm(r) {
  if (Array.isArray(r)) return r;
  const n = Number(r) || 0;
  return [n, n, n, n];
}

function traceRoundedRect(ctx, x, y, w, h, radii) {
  const [tl, tr, br, bl] = radii;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// 아이폰 사파리 공유 창은 클릭 직후 동기 호출이 필요하므로 toDataURL로 동기 합성한다
function buildCollagePdf(preset, layout, cells, state) {
  const pxW = mmToPx(preset.paper.w);
  const pxH = mmToPx(preset.paper.h);
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  const theme = resolveCollageTheme(cells, state.tone);

  // 1) 배경색
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, pxW, pxH);

  // 2) 둥근 모서리 5컷 사진 (각 칸의 preview는 이미 300dpi + 필터·인쇄 보정 완료)
  layout.cells.forEach((cell, i) => {
    const entry = cells[i];
    if (!entry || !entry.preview) return;
    const x = mmToPx(cell.x), y = mmToPx(cell.y);
    const w = mmToPx(cell.w), h = mmToPx(cell.h);
    const radii = slotRadiiMm(cell.r).map(mmToPx);
    ctx.save();
    traceRoundedRect(ctx, x, y, w, h, radii);
    ctx.clip();
    ctx.drawImage(entry.preview, x, y, w, h);
    ctx.restore();
  });

  // 3) 잡지 타이포그래피
  const T = preset.typo;
  const fontStack = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.fillStyle = theme.fg;
  ctx.textBaseline = 'top';

  // 오른쪽 위 3줄 문구
  const capLines = (state.lines || []).filter((s) => s && s.trim());
  if (capLines.length) {
    ctx.font = `500 ${mmToPx(T.caption.size)}px ${fontStack}`;
    ctx.textAlign = 'left';
    capLines.forEach((line, idx) => {
      ctx.fillText(line.trim(), mmToPx(T.caption.x), mmToPx(T.caption.y + idx * T.caption.lineH), mmToPx(T.caption.w));
    });
  }

  // 왼쪽 아래 큰 월 표기 예: (Nov)
  if (state.monthText && state.monthText.trim()) {
    ctx.font = `400 ${mmToPx(T.month.size)}px ${fontStack}`;
    ctx.textAlign = 'left';
    ctx.fillText(state.monthText.trim(), mmToPx(T.month.x), mmToPx(T.month.y), mmToPx(T.month.w));
  }

  // 맨 아래 양쪽 연도 표기 예: (20) ... (26)
  const [yL, yR] = yearHalves(state.year);
  if (yL || yR) {
    ctx.font = `500 ${mmToPx(T.year.size)}px ${fontStack}`;
    const yPos = mmToPx(T.year.y);
    if (yL) {
      ctx.textAlign = 'left';
      ctx.fillText(yL, mmToPx(T.year.x), yPos);
    }
    if (yR) {
      ctx.textAlign = 'right';
      ctx.fillText(yR, mmToPx(T.year.x + T.year.w), yPos);
    }
  }

  const bytes = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.94));
  freeCanvas(canvas);

  const doc = new PdfDoc(preset.paper.w, preset.paper.h);
  doc.image(bytes, pxW, pxH, 0, 0, preset.paper.w, preset.paper.h);
  return doc.toBlob();
}
