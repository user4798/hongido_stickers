// editor.js — 칸 안에서 사진 이동·확대·회전하는 편집 화면
// 한 손가락: 이동 / 두 손가락: 확대·축소, 회전 / 두 번 톡: 처음 배치로 / (PC) 마우스 휠: 확대
// 좌표: 편집값(edit)은 칸 사진의 300dpi 픽셀 기준. 화면 좌표(CSS 픽셀)와는 k 배 차이.

const Editor = (() => {
  let opts = null;          // openEditor에 넘긴 값
  let img = null;           // 보관용 사진
  let edit = null;          // 지금 편집값
  let pxW = 0, pxH = 0;     // 칸 사진 크기(픽셀)
  let canvas, ctx, dpr = 1;
  let frame = { x: 0, y: 0, w: 0, h: 0, k: 1 };  // 화면 위 칸 프레임 위치(CSS 픽셀), k = 화면/칸픽셀
  const pointers = new Map();
  let prev = null;          // 직전 손가락 상태
  let anim = 0;
  let wheelTimer = 0;
  let lastTap = { t: 0, x: 0, y: 0 };
  let downInfo = null;

  const $ = (id) => document.getElementById(id);

  // ---------- 화면 배치 ----------

  function layoutStage() {
    const stage = $('editorStage');
    const r = stage.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    // 프레임: 화면 가운데, 위아래·좌우로 넘친 사진이 보이도록 여백을 둔다
    const fh = Math.min(r.height * 0.66, (r.width - 96) * pxH / pxW);
    const fw = fh * pxW / pxH;
    frame = { x: (r.width - fw) / 2, y: (r.height - fh) / 2 - 10, w: fw, h: fh, k: fw / pxW };
  }

  // ---------- 그리기 ----------

  function draw() {
    const { x, y, w, h, k } = frame;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const place = (alpha) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(k, k);
      drawEdited(ctx, img, opts.source, edit);
      ctx.restore();
    };

    place(0.32);                       // 프레임 밖: 반투명
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, w, h);
    place(1);                          // 프레임 안: 선명하게

    // 3등분 보조선
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x + (w * i) / 3, y); ctx.lineTo(x + (w * i) / 3, y + h);
      ctx.moveTo(x, y + (h * i) / 3); ctx.lineTo(x + w, y + (h * i) / 3);
    }
    ctx.stroke();

    // 칼선(제품 스티커 크기) 점선
    const s = opts.sticker;
    const sw = (s.w / opts.cell.w) * w;
    const sh = (s.h / opts.cell.h) * h;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    roundRect(x + (w - sw) / 2, y + (h - sh) / 2, sw, sh, 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 프레임 테두리
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffb547';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 0.75, y - 0.75, w + 1.5, h + 1.5);

    // 각도·배율 표시
    const smin = minScale(edit.angle, opts.source, pxW, pxH);
    let deg = Math.round((edit.angle * 180) / Math.PI) % 360;
    if (deg > 180) deg -= 360;
    if (deg <= -180) deg += 360;
    $('editorInfo').textContent = `${deg}° · ${(edit.scale / smin).toFixed(1)}×`;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  let rafPending = false;
  function requestDraw() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; draw(); });
  }

  // ---------- 변환 ----------

  // 화면 좌표(CSS) → 칸 픽셀 좌표
  function toCell(px, py) {
    return { x: (px - frame.x) / frame.k, y: (py - frame.y) / frame.k };
  }

  // pivot(칸 픽셀)을 중심으로 ds배 확대, da만큼 회전, (mx,my)만큼 이동
  function applyGesture(pivot, ds, da, mx, my) {
    const smin = minScale(edit.angle + da, opts.source, pxW, pxH);
    // 손가락으로 할 때는 한도를 살짝 넘을 수 있게 (놓으면 되돌아감)
    const next = Math.min(Math.max(edit.scale * ds, smin * 0.5), smin * PHOTO.maxZoom * 1.25);
    ds = next / edit.scale;
    const cos = Math.cos(da), sin = Math.sin(da);
    const vx = (edit.cx - pivot.x) * ds;
    const vy = (edit.cy - pivot.y) * ds;
    edit = {
      angle: edit.angle + da,
      scale: next,
      cx: pivot.x + cos * vx - sin * vy + mx,
      cy: pivot.y + sin * vx + cos * vy + my,
    };
  }

  // 손을 떼면: 각도 똑바로 맞추기 + 빈틈 없애기 (부드럽게)
  function settle() {
    const snapped = { ...edit, angle: snapAngle(edit.angle) };
    animateTo(clampEdit(snapped, opts.source, pxW, pxH));
  }

  function animateTo(target) {
    cancelAnimationFrame(anim);
    const from = { ...edit };
    const start = performance.now();
    const dur = 180;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      edit = {
        angle: from.angle + (target.angle - from.angle) * e,
        scale: from.scale + (target.scale - from.scale) * e,
        cx: from.cx + (target.cx - from.cx) * e,
        cy: from.cy + (target.cy - from.cy) * e,
      };
      draw();
      if (t < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  // ---------- 손가락 ----------

  function snapshot() {
    const pts = [...pointers.values()];
    if (pts.length === 0) return null;
    if (pts.length === 1) return { n: 1, x: pts[0].x, y: pts[0].y };
    const [a, b] = pts;
    return {
      n: 2,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      ang: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  function onDown(e) {
    cancelAnimationFrame(anim);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 캡처 못 해도 동작은 계속 */ }
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    prev = snapshot();
    if (pointers.size === 1) downInfo = { t: performance.now(), x: e.offsetX, y: e.offsetY, moved: false };
    else downInfo = null;
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const cur = snapshot();
    if (!prev || cur.n !== prev.n) { prev = cur; return; }
    const k = frame.k;
    if (cur.n === 1) {
      edit = { ...edit, cx: edit.cx + (cur.x - prev.x) / k, cy: edit.cy + (cur.y - prev.y) / k };
      if (downInfo && Math.hypot(cur.x - downInfo.x, cur.y - downInfo.y) > 8) downInfo.moved = true;
    } else {
      const pivot = toCell(prev.x, prev.y);
      applyGesture(pivot, cur.dist / prev.dist, cur.ang - prev.ang, (cur.x - prev.x) / k, (cur.y - prev.y) / k);
    }
    prev = cur;
    requestDraw();
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    prev = snapshot();
    if (pointers.size > 0) return;

    // 두 번 톡 → 처음 배치로
    if (downInfo && !downInfo.moved) {
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(e.offsetX - lastTap.x, e.offsetY - lastTap.y) < 30) {
        lastTap = { t: 0, x: 0, y: 0 };
        animateTo(defaultEdit(opts.source, opts.cell));
        return;
      }
      lastTap = { t: now, x: e.offsetX, y: e.offsetY };
    }
    settle();
  }

  function onWheel(e) {
    e.preventDefault();
    cancelAnimationFrame(anim);
    applyGesture(toCell(e.offsetX, e.offsetY), Math.exp(-e.deltaY * 0.0015), 0, 0, 0);
    requestDraw();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(settle, 220);
  }

  // ---------- 열기·닫기 ----------

  async function open(o) {
    opts = o;
    ({ pxW, pxH } = cellPx(o.cell));
    edit = { ...o.edit };
    img = await loadImage(o.source.blob);
    $('editorTitle').textContent = o.title;
    $('editor').hidden = false;
    document.body.classList.add('editing');
    layoutStage();
    draw();
  }

  function close() {
    cancelAnimationFrame(anim);
    pointers.clear();
    $('editor').hidden = true;
    document.body.classList.remove('editing');
    img = null;
    opts = null;
  }

  function finish(cb) {
    const o = opts;
    const result = clampEdit({ ...edit, angle: snapAngle(edit.angle) }, o.source, pxW, pxH);
    close();
    cb(o, result);
  }

  function init() {
    canvas = $('editorCanvas');
    ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    // 사파리가 두 손가락 동작을 화면 확대로 가로채지 않게
    ['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => {
      if (opts) e.preventDefault();
    }));
    window.addEventListener('resize', () => { if (opts) { layoutStage(); draw(); } });

    $('editorCancel').addEventListener('click', close);
    $('editorDone').addEventListener('click', () => finish((o, r) => o.onDone(r)));
    $('editorRotate').addEventListener('click', () => {
      const next = { ...edit, angle: edit.angle + Math.PI / 2 };
      animateTo(clampEdit(next, opts.source, pxW, pxH));
    });
    $('editorFit').addEventListener('click', () => animateTo(defaultEdit(opts.source, opts.cell)));
    $('editorReplace').addEventListener('click', () => { const o = opts; close(); o.onReplace(); });
    $('editorClear').addEventListener('click', () => { const o = opts; close(); o.onClear(); });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { open, isOpen: () => !!opts, current: () => edit };
})();
