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

// 2) 보관용 사진을 칸 크기(300dpi)에 맞게 돌리고, 넘치는 부분은 잘라 꽉 채운다.
async function renderForCell(source, rotation, cell) {
  const img = await loadImage(source.blob);
  const pxW = mmToPx(cell.w);
  const pxH = mmToPx(cell.h);
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pxW, pxH);

  const turned = rotation % 180 !== 0;
  const rw = turned ? source.h : source.w;   // 돌린 뒤의 가로·세로
  const rh = turned ? source.w : source.h;
  const s = Math.max(pxW / rw, pxH / rh);    // 칸을 꽉 채우는 배율 (넘치는 부분은 잘림)

  ctx.imageSmoothingQuality = 'high';
  ctx.translate(pxW / 2, pxH / 2);
  ctx.rotate(rotation * Math.PI / 180);      // 시계 방향
  ctx.drawImage(img, -source.w * s / 2, -source.h * s / 2, source.w * s, source.h * s);

  const blob = await canvasToBlob(canvas, PHOTO.jpegQuality);
  freeCanvas(canvas);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob, bytes, pxW, pxH };
}
