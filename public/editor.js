// editor.js — 칸 안에서 사진 이동·확대·회전하는 편집 화면
// 한 손가락: 이동 / 두 손가락: 확대·축소, 회전 / 두 번 톡: 처음 배치로 / (PC) 마우스 휠: 확대
// 좌표: 편집값(edit)은 칸 사진의 300dpi 픽셀 기준. 화면 좌표(CSS 픽셀)와는 k 배 차이.

const Editor = (() => {
  let opts = null;          // openEditor에 넘긴 값
  let img = null;           // 보관용 사진
  let base = null;          // 화면용으로 줄인 사진 (필터 미리 보기의 바탕)
  let dispImg = null;       // 필터를 입힌 화면용 사진
  let look = null;          // 지금 필터 { id, amount }
  let applyAll = false;     // '모든 칸에 적용'
  let edit = null;          // 지금 편집값
  let initEdit = null;      // 열었을 때 편집값 (변경 여부 확인용)
  let initLook = null;      // 열었을 때 필터 (변경 여부 확인용)
  let pxW = 0, pxH = 0;     // 칸 사진 크기(픽셀)
  let canvas, ctx, dpr = 1;
  let frame = { x: 0, y: 0, w: 0, h: 0, k: 1 };  // 화면 위 칸 프레임 위치(CSS 픽셀), k = 화면/칸픽셀
  const pointers = new Map();
  let prev = null;          // 직전 손가락 상태
  let anim = 0;
  let wheelTimer = 0;
  let lastTap = { t: 0, x: 0, y: 0 };
  let downInfo = null;
  let suppressClickUntil = 0;  // 두 손가락 동작 직후 버튼이 잘못 눌리는 것 막기

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
      drawEdited(ctx, dispImg || img, opts.source, edit);
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

    // 칼선(제품 스티커 크기) 점선 — 칼선이 있는 용지에서만
    const s = opts.sticker;
    if (s) {
      const sw = (s.w / opts.cell.w) * w;
      const sh = (s.h / opts.cell.h) * h;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      roundRect(x + (w - sw) / 2, y + (h - sh) / 2, sw, sh, 6);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // 프레임 테두리
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f81a44';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 0.75, y - 0.75, w + 1.5, h + 1.5);

    // 각도·배율 표시
    const smin = minScale(edit.angle, opts.source, pxW, pxH);
    let deg = Math.round((edit.angle * 180) / Math.PI) % 360;
    if (deg > 180) deg -= 360;
    if (deg <= -180) deg += 360;
    $('editorInfo').textContent = `${deg}° · ${(edit.scale / smin).toFixed(1)}×${edit.flip ? ' · 반전' : ''}`;
    syncRotateUI(smin);
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
      flip: edit.flip,
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
        flip: target.flip,
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

  // 화면 좌표 → 편집 캔버스 기준 좌표 (메뉴 위에서 시작한 손가락도 같은 기준으로)
  function local(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // 편집 화면 어디에 손가락을 대도 받는다.
  // 한 손가락: 사진 위에서 시작했을 때만 이동 / 두 손가락: 어디서 시작하든 사진 확대·회전
  function onDown(e) {
    if (!opts) return;
    const onPhoto = e.target === canvas;
    if (pointers.size === 0 && !onPhoto) {
      // 메뉴 버튼 위 한 손가락: 버튼 누르기로 두고 기억만 해 둔다 (두 번째 손가락이 오면 확대로)
      pointers.set(e.pointerId, { ...local(e), passive: true });
      prev = null;
      downInfo = null;
      return;
    }
    rulerBase = null;
    cancelAnimationFrame(anim);
    if (onPhoto) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 캡처 못 해도 동작은 계속 */ }
    }
    pointers.set(e.pointerId, local(e));
    for (const p of pointers.values()) delete p.passive;
    prev = snapshot();
    if (pointers.size === 1) {
      const pt = local(e);
      downInfo = { t: performance.now(), x: pt.x, y: pt.y, moved: false };
    } else {
      downInfo = null;
      suppressClickUntil = Infinity;   // 두 손가락 동작 중에는 버튼이 눌리지 않게
    }
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.set(e.pointerId, { ...local(e), passive: p.passive });
    if (p.passive) return;              // 메뉴 위 한 손가락은 무시
    const cur = snapshot();
    if (!prev || cur.n !== prev.n) { prev = cur; return; }
    const k = frame.k;
    if (cur.n === 1) {
      edit = { ...edit, cx: edit.cx + (cur.x - prev.x) / k, cy: edit.cy + (cur.y - prev.y) / k };
      if (downInfo && Math.hypot(cur.x - downInfo.x, cur.y - downInfo.y) > 8) downInfo.moved = true;
    } else {
      const pivot = toCell(prev.x, prev.y);
      const ds = prev.dist > 1 ? cur.dist / prev.dist : 1;
      applyGesture(pivot, ds, cur.ang - prev.ang, (cur.x - prev.x) / k, (cur.y - prev.y) / k);
    }
    prev = cur;
    requestDraw();
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (p.passive) return;              // 버튼을 그냥 누른 것
    prev = snapshot();
    if (pointers.size > 0) {
      for (const q of pointers.values()) delete q.passive;   // 남은 손가락으로 계속 이동
      return;
    }
    if (suppressClickUntil === Infinity) suppressClickUntil = performance.now() + 400;

    // 두 번 톡 → 처음 배치로 (사진 위에서만)
    const pt = local(e);
    if (downInfo && !downInfo.moved) {
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(pt.x - lastTap.x, pt.y - lastTap.y) < 30) {
        lastTap = { t: 0, x: 0, y: 0 };
        animateTo(defaultEdit(opts.source, opts.cell));
        return;
      }
      lastTap = { t: now, x: pt.x, y: pt.y };
    }
    settle();
  }

  function onWheel(e) {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const pt = local(e);
    applyGesture(toCell(pt.x, pt.y), Math.exp(-e.deltaY * 0.0015), 0, 0, 0);
    requestDraw();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(settle, 220);
  }

  // ---------- 필터 ----------

  const PREVIEW_MAX = 900;   // 화면 미리 보기용 사진의 긴 쪽 픽셀 (빠르게 계산하려고 줄임)

  function makeBase(image, source) {
    const s = Math.min(1, PREVIEW_MAX / Math.max(source.w, source.h));
    const c = document.createElement('canvas');
    c.width = Math.round(source.w * s);
    c.height = Math.round(source.h * s);
    c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
    return c;
  }

  // 화면용 사진에 지금 필터를 입힌다 (색만, 입자·선명도는 인쇄용에만)
  function refreshPreview() {
    if (!base) return;
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const cctx = c.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(base, 0, 0);
    applyLook(cctx, c.width, c.height, look, printFixEnabled(), 'preview');
    dispImg = c;
  }

  let refreshPending = false;
  function scheduleRefresh() {
    if (refreshPending) return;
    refreshPending = true;
    setTimeout(() => { refreshPending = false; refreshPreview(); draw(); }, 30);
  }

  // 필터 줄: 이 칸의 지금 구도로 만든 작은 미리 보기
  function buildStrip() {
    const strip = $('filterStrip');
    strip.innerHTML = '';
    const tw = 54;
    const th = Math.round(tw * pxH / pxW);
    FILTERS.forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'filter-thumb';
      btn.dataset.id = f.id;
      const c = document.createElement('canvas');
      c.width = tw * 2;
      c.height = th * 2;
      const cctx = c.getContext('2d', { willReadFrequently: true });
      cctx.fillStyle = '#fff';
      cctx.fillRect(0, 0, c.width, c.height);
      cctx.save();
      cctx.scale(c.width / pxW, c.height / pxH);
      drawEdited(cctx, base, opts.source, edit);
      cctx.restore();
      applyLook(cctx, c.width, c.height, { id: f.id, amount: f.defaultAmount ?? 1 }, printFixEnabled(), 'preview');
      const label = document.createElement('span');
      label.textContent = f.name;
      btn.append(c, label);
      btn.addEventListener('click', () => onFilterTap(f.id));
      strip.appendChild(btn);
    });
  }

  function onFilterTap(id) {
    if (look.id === id) {
      // 같은 필터를 한 번 더 누르면 강도 막대 열기/닫기
      if (id !== 'none') $('filterAmountRow').hidden = !$('filterAmountRow').hidden;
      return;
    }
    look = { id, amount: findFilter(id).defaultAmount ?? 1 };
    $('filterAmountRow').hidden = true;
    refreshPreview();
    draw();
    syncFilterUI();
  }

  function syncFilterUI() {
    document.querySelectorAll('.filter-thumb').forEach((b) => {
      b.classList.toggle('on', b.dataset.id === look.id);
    });
    const pct = Math.round((look.amount ?? 1) * 100);
    $('filterAmount').value = pct;
    $('filterAmountValue').textContent = pct;
    $('filterAmountLabel').textContent = findFilter(look.id).name;
    if (look.id === 'none') $('filterAmountRow').hidden = true;
    const all = $('applyAllBtn');
    all.classList.toggle('on', applyAll);
    all.setAttribute('aria-pressed', applyAll ? 'true' : 'false');
  }

  // ---------- 회전 도구 (각도 눈금 · 90° · 좌우 반전) · PC 확대 막대 ----------

  const QUARTER = Math.PI / 2;
  const DEG = Math.PI / 180;
  let rotateMode = false;
  let rulerBase = null;   // 각도 눈금을 움직이는 동안 기준 90° 각도를 고정 (±45° 끝에서 90° 튀는 것 방지)

  // 지금 각도를 '90°의 배수 + 미세 각도'로 나눈다
  function splitAngle(a) {
    const base = rulerBase !== null ? rulerBase : Math.round(a / QUARTER) * QUARTER;
    return { base, fine: (a - base) / DEG };
  }

  function setRotateMode(on) {
    rotateMode = on;
    rulerBase = null;
    $('rotatePanel').hidden = !on;
    document.querySelector('.filter-panel').hidden = on;
    $('editorRotate').classList.toggle('on', on);
    if (opts) { layoutStage(); draw(); }
  }

  function syncRotateUI(smin) {
    if (rotateMode) {
      const { fine } = splitAngle(edit.angle);
      const v = Math.round(fine * 2) / 2;
      if (document.activeElement !== $('angleRuler')) $('angleRuler').value = v;
      $('angleValue').textContent = `${v > 0 ? '+' : ''}${v.toFixed(v % 1 ? 1 : 0)}°`;
      $('flipBtn').classList.toggle('on', !!edit.flip);
      $('flipBtn').setAttribute('aria-pressed', edit.flip ? 'true' : 'false');
    }
    if (isFinePointer() && document.activeElement !== $('zoomRange')) {
      $('zoomRange').value = Math.round((edit.scale / smin) * 100);
    }
  }

  function isFinePointer() {
    return window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  }

  // 바뀐 값으로 빈틈 없이 바로 맞춘다 (막대를 움직일 때는 애니메이션 없이)
  function applyNow(next) {
    cancelAnimationFrame(anim);                      // 돌던 애니메이션이 막대 값을 덮어쓰지 않게
    edit = clampEdit(next, opts.source, pxW, pxH);
    requestDraw();
  }

  function onAngleInput(e) {
    let v = Number(e.target.value);
    if (Math.abs(v) < 0.8) v = 0;                       // 0° 근처는 똑바로 붙게
    if (rulerBase === null) rulerBase = Math.round(edit.angle / QUARTER) * QUARTER;
    applyNow({ ...edit, angle: rulerBase + v * DEG });
  }

  function onZoomInput(e) {
    const smin = minScale(edit.angle, opts.source, pxW, pxH);
    const target = smin * Number(e.target.value) / 100;
    const center = { x: pxW / 2, y: pxH / 2 };
    applyGesture(center, target / edit.scale, 0, 0, 0);
    applyNow(edit);
  }

  function sameEdit(a, b) {
    return Math.abs(a.angle - b.angle) < 1e-4
      && Math.abs(a.scale - b.scale) < 1e-4
      && Math.abs(a.cx - b.cx) < 0.05
      && Math.abs(a.cy - b.cy) < 0.05
      && !!a.flip === !!b.flip;
  }

  function sameLook(a, b) {
    return (a.id || 'none') === (b.id || 'none')
      && Math.abs((a.amount ?? 1) - (b.amount ?? 1)) < 1e-3;
  }

  function isDirty() {
    if (!opts || !initEdit) return false;
    const cur = clampEdit({ ...edit, angle: snapAngle(edit.angle) }, opts.source, pxW, pxH);
    return !sameEdit(cur, initEdit) || !sameLook(look, initLook) || applyAll;
  }

  // ---------- 열기·닫기 ----------

  async function open(o) {
    opts = o;
    ({ pxW, pxH } = cellPx(o.cell));
    edit = { ...o.edit };
    initEdit = { ...o.edit };
    img = o.source.bitmap;   // 메모리에 들고 있는 사진을 바로 쓴다 (다시 열지 않음)
    look = { ...(o.look || { id: 'none', amount: 1 }) };
    initLook = { ...look };
    applyAll = false;
    rulerBase = null;
    base = makeBase(img, o.source);
    refreshPreview();
    buildStrip();
    $('applyAllBtn').hidden = !(o.filledCount > 1);
    syncFilterUI();
    $('editorTitle').textContent = o.title;
    $('editorHint').textContent = isFinePointer() ? '휠: 확대 · 끌기: 이동' : '한 손가락 이동 · 두 손가락 확대·회전';
    $('zoomRow').hidden = !isFinePointer();
    $('rotatePanel').hidden = true;
    document.querySelector('.filter-panel').hidden = false;
    rotateMode = false;
    $('editorRotate').classList.remove('on');
    $('editor').hidden = false;
    document.body.classList.add('editing');
    layoutStage();
    draw();
  }

  function close() {
    cancelAnimationFrame(anim);
    pointers.clear();
    suppressClickUntil = 0;
    rulerBase = null;
    $('editor').hidden = true;
    document.body.classList.remove('editing');
    img = null;
    base = null;
    dispImg = null;
    initEdit = null;
    initLook = null;
    opts = null;
  }

  function finish(cb) {
    const o = opts;
    const result = clampEdit({ ...edit, angle: snapAngle(edit.angle) }, o.source, pxW, pxH);
    const changed = !sameEdit(result, initEdit) || !sameLook(look, initLook) || applyAll;
    const nextLook = { ...look };
    const all = applyAll;
    close();
    if (changed) cb(o, result, nextLook, all);
  }

  function init() {
    canvas = $('editorCanvas');
    ctx = canvas.getContext('2d');
    const root = $('editor');
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    root.addEventListener('wheel', onWheel, { passive: false });
    // 아이폰 사파리: 편집 화면에서 두 손가락이 닿으면 화면 전체 확대를 막는다
    root.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    root.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    // 두 손가락 동작 직후의 버튼 눌림은 무시
    root.addEventListener('click', (e) => {
      if (performance.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
    }, true);
    // 사파리가 두 손가락 동작을 화면 확대로 가로채지 않게
    ['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => {
      if (opts) e.preventDefault();
    }));
    window.addEventListener('resize', () => { if (opts) { layoutStage(); draw(); } });

    $('editorCancel').addEventListener('click', () => {
      if (isDirty() && !confirm('바꾼 내용을 버리고 닫을까요?')) return;
      close();
    });
    $('editorDone').addEventListener('click', () => finish((o, r, nextLook, all) => o.onDone(r, nextLook, all)));
    $('filterAmount').addEventListener('input', (e) => {
      look = { ...look, amount: Number(e.target.value) / 100 };
      $('filterAmountValue').textContent = e.target.value;
      scheduleRefresh();
    });
    $('applyAllBtn').addEventListener('click', () => { applyAll = !applyAll; syncFilterUI(); });
    $('editorRotate').addEventListener('click', () => setRotateMode(!rotateMode));
    $('rot90Btn').addEventListener('click', () => {
      rulerBase = null;
      animateTo(clampEdit({ ...edit, angle: edit.angle + QUARTER }, opts.source, pxW, pxH));
    });
    $('flipBtn').addEventListener('click', () => applyNow({ ...edit, flip: !edit.flip }));
    $('angleRuler').addEventListener('pointerdown', () => {
      rulerBase = Math.round(edit.angle / QUARTER) * QUARTER;
    });
    $('angleRuler').addEventListener('input', onAngleInput);
    $('angleRuler').addEventListener('change', () => { rulerBase = null; $('angleRuler').blur(); });
    $('angleRuler').addEventListener('blur', () => { rulerBase = null; });
    $('zoomRange').addEventListener('input', onZoomInput);
    $('zoomRange').addEventListener('change', () => $('zoomRange').blur());
    $('editorFit').addEventListener('click', () => { rulerBase = null; animateTo(defaultEdit(opts.source, opts.cell)); });
    $('editorReplace').addEventListener('click', () => { const o = opts; close(); o.onReplace(); });
    $('editorClear').addEventListener('click', () => {
      if (!confirm('이 칸의 사진을 비울까요?')) return;
      const o = opts;
      close();
      o.onClear();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { open, isOpen: () => !!opts, current: () => edit };
})();
