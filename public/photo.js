// photo.js — 사진 불러오기, 칸에 맞게 돌리고 자르기
// 사진은 기기 밖으로 보내지 않고 브라우저 안(캔버스)에서만 처리한다.
// 캔버스: 브라우저 안에서 그림을 그리고 사진으로 저장할 수 있는 도화지

const MM_PER_INCH = 25.4;

function mmToPx(mm) {
  return Math.round(mm / MM_PER_INCH * PHOTO.dpi);
}

// 파일/Blob → <img>. <img>로 열면 사파리가 사진 방향 정보(EXIF)를 반영해 바로 세워 준다.
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 열 수 없어요')); };
    img.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('사진 저장 실패'))), 'image/jpeg', quality);
  });
}

function freeCanvas(canvas) {
  // 아이폰 사파리는 캔버스 메모리를 늦게 돌려주므로 크기를 0으로 만들어 바로 비운다.
  canvas.width = 0;
  canvas.height = 0;
}

// 1) 고른 사진을 적당한 크기로 줄여 보관용 JPEG로 만든다.
async function loadSource(file) {
  const img = await loadImage(file);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  const scale = Math.min(1, PHOTO.sourceMaxPx / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await canvasToBlob(canvas, PHOTO.sourceQuality);
  freeCanvas(canvas);
  return { blob, w, h };
}

// 가로 사진을 세로 칸에 넣을 때(또는 반대)는 90° 돌려서 넣는다.
function defaultRotation(source, cell) {
  const photoLandscape = source.w > source.h;
  const cellLandscape = cell.w > cell.h;
  return photoLandscape !== cellLandscape ? 90 : 0;
}

// ---------- 사진 위치(편집값) ----------
// 편집값 edit = { angle, scale, cx, cy }
//   칸 사진(300dpi 픽셀) 좌표에서, 사진 한가운데가 (cx, cy)에 오고,
//   angle(라디안, 시계 방향)만큼 돌고, 원본 1픽셀이 scale 픽셀 크기로 그려진다.

function cellPx(cell) {
  return { pxW: mmToPx(cell.w), pxH: mmToPx(cell.h) };
}

// 이 각도에서 칸을 빈틈없이 덮는 가장 작은 배율
function minScale(angle, source, pxW, pxH) {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return Math.max((pxW * c + pxH * s) / source.w, (pxW * s + pxH * c) / source.h);
}

// 처음 자동 배치: 가로 사진은 90° 돌리고, 칸을 꽉 채워 가운데에
function defaultEdit(source, cell) {
  const { pxW, pxH } = cellPx(cell);
  const angle = defaultRotation(source, cell) * Math.PI / 180;
  return { angle, scale: minScale(angle, source, pxW, pxH), cx: pxW / 2, cy: pxH / 2 };
}

// 각도가 0°·90°·180°·270° 근처면 똑바로 맞춘다
function snapAngle(angle) {
  const quarter = Math.PI / 2;
  const nearest = Math.round(angle / quarter) * quarter;
  return Math.abs(angle - nearest) <= PHOTO.snapDeg * Math.PI / 180 ? nearest : angle;
}

// 칸에 흰 빈틈이 생기지 않도록 배율과 위치를 바로잡는다 (최대 확대도 제한)
function clampEdit(e, source, pxW, pxH) {
  const smin = minScale(e.angle, source, pxW, pxH);
  const scale = Math.min(Math.max(e.scale, smin), smin * PHOTO.maxZoom);
  const cos = Math.cos(e.angle);
  const sin = Math.sin(e.angle);
  // 칸의 반쪽 크기를 사진 방향 기준으로 잰 값
  const ex = (pxW * Math.abs(cos) + pxH * Math.abs(sin)) / 2;
  const ey = (pxW * Math.abs(sin) + pxH * Math.abs(cos)) / 2;
  const lx = Math.max(0, source.w * scale / 2 - ex);
  const ly = Math.max(0, source.h * scale / 2 - ey);
  // 칸 가운데가 사진 가운데에서 얼마나 떨어졌는지 (사진 방향 기준)
  const fx = pxW / 2 - e.cx;
  const fy = pxH / 2 - e.cy;
  const dx = Math.min(lx, Math.max(-lx, cos * fx + sin * fy));
  const dy = Math.min(ly, Math.max(-ly, -sin * fx + cos * fy));
  return {
    angle: e.angle,
    scale,
    cx: pxW / 2 - (cos * dx - sin * dy),
    cy: pxH / 2 - (sin * dx + cos * dy),
  };
}

// 편집값대로 사진을 캔버스에 그린다 (칸 사진 만들기와 편집 화면이 함께 씀)
function drawEdited(ctx, img, source, e) {
  ctx.save();
  ctx.translate(e.cx, e.cy);
  ctx.rotate(e.angle);
  ctx.scale(e.scale, e.scale);
  ctx.drawImage(img, -source.w / 2, -source.h / 2, source.w, source.h);
  ctx.restore();
}

// 2) 보관용 사진을 편집값대로 칸 크기(300dpi) 사진으로 만든다. 넘치는 부분은 잘린다.
//    look = 필터 { id, amount }. 인쇄 보정은 설정에 따라 함께 적용.
async function renderForCell(source, edit, cell, look) {
  const img = await loadImage(source.blob);
  const { pxW, pxH } = cellPx(cell);
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pxW, pxH);
  ctx.imageSmoothingQuality = 'high';
  drawEdited(ctx, img, source, edit);
  applyLook(ctx, pxW, pxH, look, printFixEnabled(), 'print');

  const blob = await canvasToBlob(canvas, PHOTO.jpegQuality);
  freeCanvas(canvas);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob, bytes, pxW, pxH };
}
