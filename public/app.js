// app.js — 사진을 칸에 배치하고 인쇄 PDF 만들기

// 지금 쓰는 판형 (용지 칩을 눌러 바꿀 수 있음)
let presetId = getPresetId();
let preset = PRESETS[presetId];
let layout = layoutOf(preset);

// 칸마다 { source, edit, look, preview(캔버스), print: {bytes, pxW, pxH} 또는 null(만드는 중), ready(약속) } 또는 null
// edit = 사진 위치·배율·각도 (photo.js 참고), look = 필터 { id, amount } (filters.js 참고)
const NO_LOOK = { id: 'none', amount: 1 };
let cells = layout.cells.map(() => null);

// 빈 칸만 인쇄: 이미 인쇄해서 쓴 칸(사용함)과, 마지막으로 인쇄한 칸 번호
let used = layout.cells.map(() => false);
let lastPrinted = [];
let markMode = false;   // '이미 쓴 칸 표시하기' 중인지

function resetSheetState() {
  used = layout.cells.map(() => false);
  lastPrinted = [];
}

// 이 판형에서 '사용함' 기능을 쓰는지 (칸이 하나뿐인 용지는 쓰지 않음)
function canMarkUsed() {
  return layout.cells.length > 1;
}

let busy = false;
let targetCell = null;   // 마지막으로 누른 칸 번호 (0부터)

const $ = (id) => document.getElementById(id);

// 사진을 준비하는 동안 화면을 잠그고 진행 상황을 보여 준다 (그사이 다른 버튼이 눌리지 않게)
let busyTimer = 0;
function setBusy(on, text = '') {
  busy = on;
  const el = $('busy');
  if (!el) return;
  $('busyText').textContent = text;
  clearTimeout(busyTimer);
  if (on) {
    el.hidden = false;                                   // 바로 터치를 막고
    busyTimer = setTimeout(() => el.classList.add('show'), 150);   // 오래 걸릴 때만 보이게
  } else {
    el.classList.remove('show');
    el.hidden = true;
  }
}

// ---------- 칸 채우기 ----------

// 같은 원본 사진을 복제해 여러 칸이 공유할 수 있으므로, 다른 칸에서 안 쓸 때만 메모리를 비운다
function releaseIfUnused(source, exceptIndex = -1) {
  if (!source) return;
  const inUse = cells.some((c, i) => i !== exceptIndex && c && c.source === source);
  if (!inUse) releaseSource(source);
}

// 칸 사진 만들기: 미리 보기가 나오면 바로 칸에 보여 주고, 인쇄용 JPEG는 뒤에서 기다린다
async function setCellPhoto(index, source, edit, look = NO_LOOK, save = true) {
  const job = renderCell(source, edit, layout.cells[index], look);
  const preview = await job.preview;
  const old = cells[index];
  if (old) {
    if (old.preview) freeCanvas(old.preview);
    if (old.source !== source) releaseIfUnused(old.source, index);
  }
  const entry = { source, edit, look, preview, print: null, ready: null };
  entry.ready = job.done.then((p) => { entry.print = p; return p; });
  entry.ready.catch(() => {});
  cells[index] = entry;
  if (save) scheduleSave();
}

function clearCell(index) {
  const c = cells[index];
  cells[index] = null;
  lastPrinted = lastPrinted.filter((k) => k !== index);
  if (c) {
    if (c.preview) freeCanvas(c.preview);
    releaseIfUnused(c.source);
  }
  scheduleSave();
}

// ---------- 자동 저장 · 복원 ----------

let saveTimer = 0;
let restoring = false;
function saveNow() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = 0;
  Store.save({
    presetId,
    cells: cells.map((c) => (c && c.source.file ? { fileId: c.source.fileId, file: c.source.file, edit: c.edit, look: c.look } : null)),
    used,
    lastPrinted,
  });
}

function scheduleSave() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

// 다음 사진을 미리 읽어 두어(파이프라이닝) 워커 처리와 겹쳐 빠르게 불러온다
function loadSourceSafe(file, cell, fileId = null) {
  return loadSource(file, sourceMaxFor(cell), fileId)
    .then((src) => ({ ok: true, src }), (err) => ({ ok: false, err }));
}

// 지난번 작업을 그대로 되살린다
async function restore() {
  const saved = await Store.load();
  if (!saved || !saved.cells || !PRESETS[saved.presetId]) return;
  const hasUsed = Array.isArray(saved.used) && saved.used.some(Boolean);
  if (!saved.cells.some(Boolean) && !hasUsed && !(saved.lastPrinted || []).length) return;
  if (saved.presetId !== presetId) {
    presetId = saved.presetId;
    preset = PRESETS[presetId];
    layout = layoutOf(preset);
    cells = layout.cells.map(() => null);
    setPresetId(presetId);
    applyPresetLabels();
    syncPresetMenu();
    buildPaper();
    fitPaper();
  }
  resetSheetState();
  if (Array.isArray(saved.used) && saved.used.length === cells.length) used = saved.used.map(Boolean);
  if (Array.isArray(saved.lastPrinted)) lastPrinted = saved.lastPrinted.filter((i) => i >= 0 && i < cells.length);
  render();
  restoring = true;
  setBusy(true, '지난 작업 불러오는 중');
  const items = saved.cells
    .slice(0, cells.length)
    .map((item, i) => (item && item.file ? { i, item } : null))
    .filter(Boolean);
  items.forEach(({ i }) => cellButton(i).classList.add('loading'));
  let pending = items.length ? loadSourceSafe(items[0].item.file, layout.cells[items[0].i], items[0].item.fileId) : null;
  for (let k = 0; k < items.length; k++) {
    const { i, item } = items[k];
    const loaded = await pending;
    pending = k + 1 < items.length
      ? loadSourceSafe(items[k + 1].item.file, layout.cells[items[k + 1].i], items[k + 1].item.fileId)
      : null;
    if (loaded.ok) {
      try {
        await setCellPhoto(i, loaded.src, item.edit || defaultEdit(loaded.src, layout.cells[i]), item.look || NO_LOOK, false);
      } catch (e) { releaseSource(loaded.src); }
    }
    cellButton(i).classList.remove('loading');
    render();
  }
  restoring = false;
  setBusy(false);
  render();
}

// 모두 비우기:
//  - 방금 인쇄한 용지에 빈 칸이 남아 있으면 '남은 칸 이어 쓰기 / 새 용지로 시작'을 묻는다
//  - 아니면 확인 후 모두 비운다 (사용함 표시도 함께 지움 = 새 용지)
function remainingAfterPrint() {
  if (!canMarkUsed() || !lastPrinted.length) return 0;
  return cells.filter((_, i) => !used[i] && !lastPrinted.includes(i)).length;
}

let continueFromTap = false;   // 빈 칸을 눌러 '이어 쓰기' 창이 열렸는지

function clearPhotos() {
  const seen = new Set();
  cells.forEach((c) => {
    if (!c) return;
    if (c.preview) freeCanvas(c.preview);
    if (c.source && !seen.has(c.source)) {
      seen.add(c.source);
      releaseSource(c.source);
    }
  });
  cells = layout.cells.map(() => null);
}

function openContinueSheet(fromTap) {
  const left = remainingAfterPrint();
  continueFromTap = fromTap;
  $('continueTitle').textContent = `지난번 인쇄한 용지에 빈 칸이 ${left}개 남아 있어요`;
  $('continueAdd').hidden = !fromTap;
  openSheet('continueSheet');
}

function newSheet() {
  if (busy) return;
  const n = cells.filter(Boolean).length;
  const usedCount = used.filter(Boolean).length;
  if (!n && !usedCount) return;
  if (remainingAfterPrint() > 0) {
    openContinueSheet(false);
    return;
  }
  const msg = n
    ? `사진 ${n}장을 모두 비울까요?` + (usedCount ? '\n사용함 표시도 함께 지워져요.' : '')
    : '사용함 표시를 모두 지우고 새 용지로 시작할까요?';
  if (!confirm(msg)) return;
  startFresh();
}

// 새 용지로 시작: 사진, 사용함 표시, 인쇄 기록 모두 지움
function startFresh() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  clearPhotos();
  resetSheetState();
  Store.clear();
  render();
}

// 남은 칸 이어 쓰기: 지난번 인쇄한 칸을 '사용함'으로 바꾸고 사진만 비움
function continueSheet() {
  lastPrinted.forEach((i) => { used[i] = true; });
  lastPrinted = [];
  clearPhotos();
  render();
  scheduleSave();
  toast(`남은 ${used.filter((u) => !u).length}칸에 이어서 인쇄할 수 있어요`);
}

// 설정을 바꿨을 때(예: 인쇄 보정) 칸 사진을 모두 다시 만든다
async function rerenderAll() {
  const filled = cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (!filled.length) return;
  setBusy(true, '다시 만드는 중');
  for (let k = 0; k < filled.length; k++) {
    const i = filled[k];
    if (filled.length > 1) $('busyText').textContent = `다시 만드는 중 ${k + 1} / ${filled.length}`;
    const c = cells[i];
    await setCellPhoto(i, c.source, c.edit, c.look, false);
    render();
  }
  setBusy(false);
  render();
}

// 누른 칸부터 끝까지, 그다음 앞쪽의 빈 칸 순서
function emptySlotsFrom(start) {
  const n = cells.length;
  const order = [];
  for (let k = 0; k < n; k++) order.push((start + k) % n);
  return order.filter((i) => !cells[i] && !used[i]);
}

async function addFiles(files, slots) {
  if (busy || files.length === 0) return;
  const list = Array.from(files).slice(0, slots.length);
  setBusy(true, list.length > 1 ? `사진 넣는 중 1 / ${list.length}` : '사진 넣는 중');
  slots.slice(0, list.length).forEach((i) => cellButton(i).classList.add('loading'));
  render();
  let failed = 0;
  let pending = list.length ? loadSourceSafe(list[0], layout.cells[slots[0]]) : null;

  for (let k = 0; k < list.length; k++) {
    if (list.length > 1) $('busyText').textContent = `사진 넣는 중 ${k + 1} / ${list.length}`;
    const cell = layout.cells[slots[k]];
    const loaded = await pending;
    // 현재 사진을 워커에서 그리는 동안 다음 사진을 미리 읽는다
    pending = k + 1 < list.length ? loadSourceSafe(list[k + 1], layout.cells[slots[k + 1]]) : null;
    if (loaded.ok) {
      try {
        lastPrinted = lastPrinted.filter((idx) => idx !== slots[k]);
        await setCellPhoto(slots[k], loaded.src, defaultEdit(loaded.src, cell), NO_LOOK, false);
      } catch (e) {
        releaseSource(loaded.src);
        failed++;
      }
    } else {
      failed++;
    }
    cellButton(slots[k]).classList.remove('loading');
    render();
  }

  scheduleSave();
  const skipped = files.length - list.length;
  const notes = [];
  if (skipped > 0) notes.push(`빈 칸이 ${slots.length}개라 ${skipped}장은 넣지 못했어요`);
  if (failed > 0) notes.push(`${failed}장은 열 수 없는 사진이었어요`);
  if (notes.length) toast(notes.join(' · '));
  setBusy(false);
  render();
}

// 편집 화면에서 '완료'를 누르면 그 위치·필터대로 칸 사진을 다시 만든다.
// applyAll이면 같은 필터를 사진이 든 다른 칸에도 적용한다.
async function applyEdit(index, edit, look, applyAll) {
  const c = cells[index];
  if (!c) return;
  setBusy(true, '사진 적용 중');
  const targets = applyAll ? cells.map((x, i) => (x ? i : -1)).filter((i) => i >= 0) : [index];
  targets.forEach((i) => cellButton(i).classList.add('loading'));
  for (const i of targets) {
    const ci = cells[i];
    await setCellPhoto(i, ci.source, i === index ? edit : ci.edit, look, false);
    cellButton(i).classList.remove('loading');
    render();
  }
  scheduleSave();
  setBusy(false);
  render();
  if (applyAll && targets.length > 1) toast(`${targets.length}칸에 ${findFilter(look.id).name} 적용`);
}

async function stepEditor(index, dir, edit, look, applyAll, changed) {
  const filled = cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const pos = filled.indexOf(index);
  if (changed) await applyEdit(index, edit, look, applyAll);
  if (filled.length < 2 || pos < 0) return;
  const nextIdx = filled[(pos + dir + filled.length) % filled.length];
  if (cells[nextIdx]) openEditor(nextIdx);
}

async function duplicateCell(index, edit, look, applyAll, changed) {
  const c = cells[index];
  if (!c) return;
  if (changed) await applyEdit(index, edit, look, applyAll);
  const slots = emptySlotsFrom((index + 1) % cells.length);
  if (!slots.length) { toast('남은 빈 칸이 없어요'); return; }
  const dest = slots[0];
  setBusy(true, '빈 칸에 복제 중');
  cellButton(dest).classList.add('loading');
  const nextEdit = sameSize(index, dest) ? { ...edit } : defaultEdit(c.source, layout.cells[dest]);
  await setCellPhoto(dest, c.source, nextEdit, { ...look });
  cellButton(dest).classList.remove('loading');
  setBusy(false);
  render();
  toast(`${dest + 1}번 칸에 복제했어요`);
}

function openEditor(index) {
  const c = cells[index];
  Editor.open({
    title: `${index + 1}번 칸`,
    source: c.source,
    edit: c.edit,
    look: c.look,
    cell: layout.cells[index],
    sticker: preset.sticker || null,
    filledCount: cells.filter(Boolean).length,
    canDuplicate: emptySlotsFrom((index + 1) % cells.length).length > 0,
    onDone: (edit, look, applyAll) => applyEdit(index, edit, look, applyAll),
    onStep: (dir, edit, look, applyAll, changed) => stepEditor(index, dir, edit, look, applyAll, changed),
    onDuplicate: (edit, look, applyAll, changed) => duplicateCell(index, edit, look, applyAll, changed),
    onReplace: () => { targetCell = index; $('oneInput').click(); },
    onClear: () => { clearCell(index); render(); },
  });
}

// ---------- 인쇄 ----------

function buildPrintPdf() {
  const cal = loadCalibration();
  const doc = new PdfDoc(preset.paper.w, preset.paper.h);
  layout.cells.forEach((cell, i) => {
    const c = cells[i];
    if (!c) return;
    doc.image(c.print.bytes, c.print.pxW, c.print.pxH, cell.x + cal.x, cell.y + cal.y, cell.w, cell.h);
  });
  return doc.toBlob();
}

function printFileName() {
  return `${preset.label}_${preset.printPaper.split(" ")[0]}_${preset.printScale}.pdf`;
}

function sendToPrint() {
  // 공유 창에서 취소하지 않고 실제로 보냈을 때만 인쇄 칸을 기억한다
  const printed = cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const file = new File([buildPrintPdf()], printFileName(), { type: 'application/pdf' });
  return sharePdf(file, UI.appTitle).then((ok) => {
    if (ok) {
      lastPrinted = printed;
      scheduleSave();
      render();
    }
    return ok;
  });
}

function skipPreflight() {
  try { return localStorage.getItem(UI.skipPreflightKey) === '1'; } catch (e) { return false; }
}

function setSkipPreflight(on) {
  try { localStorage.setItem(UI.skipPreflightKey, on ? '1' : '0'); } catch (e) { /* 저장 못 해도 동작은 계속 */ }
}

// 인쇄용 JPEG가 모두 만들어졌는지
function printReady() {
  return cells.filter(Boolean).every((c) => c.print);
}

function onPrint() {
  if (busy) return;
  if (!cells.some(Boolean)) {
    toast('먼저 칸을 눌러 사진을 넣어 주세요');
    return;
  }
  // 아이폰 공유 화면은 버튼을 누른 그 순간에만 열 수 있어서,
  // 인쇄용 사진이 아직 만들어지는 중이면 확인 화면을 띄우고 준비되면 버튼을 켠다.
  if (skipPreflight() && printReady()) {
    sendToPrint();
    return;
  }
  $('skipPreflight').checked = skipPreflight();
  const filledCount = cells.filter(Boolean).length;
  const usedCount = used.filter(Boolean).length;
  $('pfUsedRow').hidden = !usedCount;
  $('pfUsed').textContent = `${filledCount}칸 인쇄 (사용함 ${usedCount}칸 제외)`;
  $('pfMarkBtn').hidden = !canMarkUsed();
  openSheet('preflight');
  syncPrintButton();
}

function syncPrintButton() {
  const go = $('preflightGo');
  if (printReady()) {
    go.disabled = false;
    go.textContent = '확인하고 인쇄';
    return;
  }
  go.disabled = true;
  go.textContent = '사진 준비 중…';
  Promise.all(cells.filter(Boolean).map((c) => c.ready)).then(syncPrintButton, () => {
    go.textContent = '사진을 만들지 못했어요';
  });
}

// ---------- 화면 ----------

function pct(v, total) {
  return `${(v / total) * 100}%`;
}

function cellButton(i) {
  return $('paper').querySelectorAll('.cell')[i];
}

// 용지 미리 보기를 남는 공간(가로·세로)에 꽉 맞춘다
function fitPaper() {
  const stage = $('stage');
  const w = Math.min(stage.clientWidth, stage.clientHeight * preset.paper.w / preset.paper.h);
  $('paper').style.width = `${Math.floor(w)}px`;
}

function buildPaper() {
  const paper = $('paper');
  paper.querySelectorAll('.cell').forEach((b) => b.remove());
  paper.style.aspectRatio = `${preset.paper.w} / ${preset.paper.h}`;
  layout.cells.forEach((cell, i) => {
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.style.left = pct(cell.x, preset.paper.w);
    btn.style.top = pct(cell.y, preset.paper.h);
    btn.style.width = pct(cell.w, preset.paper.w);
    btn.style.height = pct(cell.h, preset.paper.h);
    btn.innerHTML = iconSvg('plus');
    // 칼선 바깥(잘려 나갈 부분)을 살짝 어둡게 보여 주는 덮개 — 칼선이 있는 용지만
    if (preset.sticker) {
      const cut = document.createElement('span');
      cut.className = 'cut';
      const mx = (cell.w - preset.sticker.w) / 2;
      const my = (cell.h - preset.sticker.h) / 2;
      cut.style.inset = `${pct(my, cell.h)} ${pct(mx, cell.w)}`;
      btn.appendChild(cut);
    }
    btn.addEventListener('click', () => onCellTap(i));
    paper.appendChild(btn);
  });
}

function render() {
  const showPrinted = remainingAfterPrint() > 0;
  cells.forEach((c, i) => {
    const btn = cellButton(i);
    btn.classList.toggle('filled', !!c);
    const shown = btn.querySelector('canvas');
    if (c && shown !== c.preview) {
      if (shown) shown.remove();
      c.preview.className = 'cell-img';
      btn.appendChild(c.preview);
    } else if (!c && shown) {
      shown.remove();
    }
    btn.classList.toggle('used', !c && !!used[i]);
    btn.classList.toggle('printed', !!c && showPrinted && lastPrinted.includes(i));
    btn.setAttribute('aria-label', c ? `${i + 1}번 칸 사진` : used[i] ? `${i + 1}번 칸 사용함` : `${i + 1}번 칸 비어 있음, 사진 고르기`);
  });
  const count = cells.filter(Boolean).length;
  const usedCount = used.filter(Boolean).length;
  const room = cells.length - usedCount;
  const allUsed = count === 0 && room === 0;
  $('countChip').innerHTML = count ? `${count}<span class="of"> / ${room}</span>` : '';
  $('countChip').setAttribute('aria-label', `남은 ${room}칸 중 ${count}장`);
  $('newSheetBtn').hidden = (count === 0 && usedCount === 0) || markMode;
  $('emptyHint').textContent = allUsed
    ? '남은 칸이 없어요 · 칸을 눌러 해제하거나 새 용지로 시작하세요'
    : usedCount ? '빈 칸을 눌러 사진을 고르세요' : '칸을 눌러 사진을 고르세요';
  $('emptyHint').classList.toggle('show', count === 0 && !busy && !markMode);
  $('paper').classList.toggle('marking', markMode);
  $('markBanner').hidden = !markMode;
  // 아래 큰 버튼: 표시 중이면 '표시 완료', 남은 칸이 없으면 '새 용지로 시작', 사진이 없으면 '사진 고르기', 있으면 'PRINT'
  const pick = count === 0;
  $('printBtn').classList.toggle('pick', pick || markMode);
  $('mainIcon').innerHTML = iconSvg(markMode ? 'check' : allUsed ? 'rotate' : pick ? 'photoAdd' : 'printer');
  $('mainLabel').textContent = markMode ? '표시 완료' : allUsed ? '새 용지로 시작' : pick ? '사진 고르기' : 'PRINT';
}

// ---------- 이미 쓴 칸 표시하기 ----------
function enterMarkMode() {
  if (!canMarkUsed()) return;
  closeSheet('presetMenu');
  closeSheet('preflight');
  markMode = true;
  render();
  fitPaper();
}

function exitMarkMode() {
  markMode = false;
  render();
  fitPaper();
  scheduleSave();
  const usedCount = used.filter(Boolean).length;
  if (usedCount) toast(`사용함 ${usedCount}칸은 건너뛰고 인쇄해요`);
}

function onMainButton() {
  if (busy) return;
  if (markMode) { exitMarkMode(); return; }
  if (!cells.some(Boolean)) {
    if (used.every(Boolean)) { newSheet(); return; }
    targetCell = 0;
    $('manyInput').click();
    return;
  }
  onPrint();
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), UI.toastMs);
}

// ---------- 판형 바꾸기 ----------

function applyPresetLabels() {
  $('paperChipText').textContent = preset.chip;
  $('preflightPaper').textContent = `${preset.label} ${preset.paperKind}`;
  $('pfPaper').textContent = preset.printPaper;
  $('pfScale').textContent = preset.printScale;
  if ($('calibRow')) $('calibRow').hidden = !preset.testSheet;
  if ($('markFromMenu')) $('markFromMenu').hidden = layoutOf(preset).cells.length < 2;
  $('sheetLabel').textContent = preset.sheetLabel || '';
  $('feedMark').hidden = !preset.feedMark;
  $('pfFeedRow').hidden = !preset.feedMark;
  $('pfNote').textContent = preset.printNote ? `${preset.printNote} '용지에 맞춤'은 꺼 주세요.` : "'용지에 맞춤'이 켜져 있으면 칸이 어긋나요.";
}

function buildPresetMenu() {
  const list = $('presetList');
  list.innerHTML = '';
  PRESET_ORDER.forEach((id) => {
    const p = PRESETS[id];
    const btn = document.createElement('button');
    btn.className = 'preset-row';
    btn.dataset.id = id;
    // 작은 판형 그림: 용지 비율과 칸 배치를 그대로 줄여서
    const mini = document.createElement('span');
    mini.className = 'preset-mini';
    mini.style.aspectRatio = `${p.paper.w} / ${p.paper.h}`;
    layoutOf(p).cells.forEach((c) => {
      const cell = document.createElement('i');
      cell.style.left = pct(c.x, p.paper.w);
      cell.style.top = pct(c.y, p.paper.h);
      cell.style.width = pct(c.w, p.paper.w);
      cell.style.height = pct(c.h, p.paper.h);
      mini.appendChild(cell);
    });
    const text = document.createElement('span');
    text.className = 'preset-text';
    text.innerHTML = `<b></b><small></small>`;
    text.querySelector('b').textContent = p.menuTitle;
    text.querySelector('small').textContent = p.menuSub;
    const check = document.createElement('span');
    check.className = 'preset-check';
    check.innerHTML = iconSvg('check');
    btn.append(mini, text, check);
    btn.addEventListener('click', () => switchPreset(id));
    list.appendChild(btn);
  });
  syncPresetMenu();
}

function syncPresetMenu() {
  document.querySelectorAll('.preset-row').forEach((b) => b.classList.toggle('on', b.dataset.id === presetId));
}

// 판형을 바꾸면 사진은 순서대로 새 칸에 다시 넣는다 (칸이 모자라면 확인 후 뒤쪽 사진을 뺀다)
async function switchPreset(id) {
  if (busy || id === presetId) { closeSheet('presetMenu'); return; }
  const next = PRESETS[id];
  const nextLayout = layoutOf(next);
  const kept = cells.filter(Boolean);
  const room = nextLayout.cells.length;
  if (kept.length > room) {
    const ok = confirm(`${next.menuTitle}에는 사진이 ${room}장 들어가요.
앞의 ${room}장만 남기고 나머지 ${kept.length - room}장은 빼도 될까요?`);
    if (!ok) return;
  }
  closeSheet('presetMenu');
  kept.forEach((c) => c.preview && freeCanvas(c.preview));
  const move = kept.slice(0, room);
  const keptSources = new Set(move.map((c) => c.source));
  const released = new Set();
  kept.slice(room).forEach((c) => {
    if (c.source && !keptSources.has(c.source) && !released.has(c.source)) {
      released.add(c.source);
      releaseSource(c.source);
    }
  });
  presetId = id;
  preset = next;
  layout = nextLayout;
  cells = layout.cells.map(() => null);
  markMode = false;
  resetSheetState();   // 다른 용지로 바꾸면 사용함 표시는 새로 시작
  setPresetId(id);
  applyPresetLabels();
  syncPresetMenu();
  buildPaper();
  fitPaper();
  render();
  // 남길 사진을 새 칸 크기에 맞춰 다시 만든다 (필터는 그대로)
  if (move.length) {
    setBusy(true, '용지에 맞추는 중');
    move.forEach((_, i) => cellButton(i).classList.add('loading'));
    const upgraded = new Map();
    for (let i = 0; i < move.length; i++) {
      let src = move[i].source;
      // 새 칸이 더 큰 사진을 필요로 하면 원본 파일에서 다시 만든다 (fileId는 유지해 재저장 방지)
      const need = sourceMaxFor(layout.cells[i]);
      if (need > src.maxPx && src.file) {
        if (upgraded.has(src)) {
          src = upgraded.get(src);
        } else {
          try {
            const fresh = await loadSource(src.file, need, src.fileId);
            upgraded.set(src, fresh);
            src = fresh;
          } catch (e) { /* 실패하면 있던 크기로 */ }
        }
      }
      await setCellPhoto(i, src, defaultEdit(src, layout.cells[i]), move[i].look, false);
      cellButton(i).classList.remove('loading');
      render();
    }
    upgraded.forEach((_, oldSrc) => releaseIfUnused(oldSrc));
    setBusy(false);
    render();
  }
  scheduleSave();
  toast(`${next.menuTitle}로 바꿨어요`);
}

function resetSheetStyle(el) {
  if (!el) return;
  clearTimeout(el._closeTimer);
  el._closeTimer = 0;
  el.style.background = '';
  el.style.transition = '';
  const panel = el.querySelector('.panel');
  if (panel) {
    panel.style.transform = '';
    panel.style.transition = '';
  }
}

function openSheet(id) {
  const el = $(id);
  resetSheetStyle(el);
  el.hidden = false;
}

function closeSheet(id) {
  const el = $(id);
  resetSheetStyle(el);
  el.hidden = true;
}

// 아래에서 올라오는 창을 손가락으로 아래로 쓸어내려 닫기
// 아이폰 사파리가 당겨서 새로고침으로 가로채지 않도록 touchmove를 막고 패널만 움직인다.
function bindSheetSwipe(id) {
  const overlay = $(id);
  const panel = overlay && overlay.querySelector('.panel');
  if (!panel) return;
  let s = null;
  let suppressClickUntil = 0;

  overlay.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
  panel.addEventListener('click', (e) => {
    if (performance.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  panel.addEventListener('pointerdown', (e) => {
    clearTimeout(overlay._closeTimer);
    overlay._closeTimer = 0;
    s = { id: e.pointerId, y0: e.clientY, lastY: e.clientY, lastT: performance.now(), vy: 0, dy: 0, dragging: false };
  });
  panel.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dy = e.clientY - s.y0;
    const now = performance.now();
    const dt = now - s.lastT;
    if (dt > 0) s.vy = (e.clientY - s.lastY) / dt;
    s.lastY = e.clientY;
    s.lastT = now;

    if (!s.dragging) {
      if (dy < 4) return;
      s.dragging = true;
      panel.style.transition = 'none';
      overlay.style.transition = 'none';
      try { panel.setPointerCapture(s.id); } catch (err) { /* 무시 */ }
    }
    s.dy = Math.max(0, dy);
    panel.style.transform = `translateY(${s.dy}px)`;
    const h = panel.offsetHeight || 300;
    const alpha = Math.max(0, 0.55 * (1 - s.dy / h));
    overlay.style.background = `rgba(0, 0, 0, ${alpha.toFixed(3)})`;
  });
  const end = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const { dragging, dy, vy } = s;
    s = null;
    if (!dragging) return;
    suppressClickUntil = performance.now() + 300;
    if (dy > 60 || (dy > 20 && vy > 0.45)) {
      panel.style.transition = 'transform 0.16s ease-out';
      overlay.style.transition = 'background 0.16s ease-out';
      panel.style.transform = `translateY(${(panel.offsetHeight || 320) + 24}px)`;
      overlay.style.background = 'rgba(0, 0, 0, 0)';
      overlay._closeTimer = setTimeout(() => closeSheet(id), 170);
    } else {
      panel.style.transition = 'transform 0.2s ease-out';
      overlay.style.transition = 'background 0.2s ease-out';
      panel.style.transform = 'translateY(0)';
      overlay.style.background = '';
    }
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
}

// 기본 화면 고무줄 탄성(러버밴딩): 새로고침 없이 위·아래 끝에서 부드럽게 밀렸다 제자리로 복귀
function bindMainRubberBand() {
  const main = document.querySelector('.layout');
  if (!main) return;
  let r = null;
  let suppressClickUntil = 0;

  const anySheetOpen = () => ['preflight', 'continueSheet', 'presetMenu', 'settings'].some((id) => !$(id).hidden);
  const rubber = (d) => {
    const a = Math.abs(d);
    // 아래로 당길 때(위쪽 끝 확인)는 넉넉하게, 위로 당길 때는 살짝만 반응
    const factor = d > 0 ? 0.45 : 0.26;
    return Math.sign(d) * (a * factor) / (1 + a / 140);
  };

  main.addEventListener('touchmove', (e) => {
    if (!Editor.isOpen() && !anySheetOpen()) e.preventDefault();
  }, { passive: false });

  main.addEventListener('click', (e) => {
    if (performance.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  main.addEventListener('pointerdown', (e) => {
    if (busy || Editor.isOpen() || anySheetOpen()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (r) return;
    r = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false };
  });

  main.addEventListener('pointermove', (e) => {
    if (!r || e.pointerId !== r.id) return;
    // 사진 길게 눌러 끌기가 시작됐으면 탄성 동작은 즉시 양보
    if (drag && drag.active) {
      if (r.active) {
        main.style.transition = 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)';
        main.style.transform = '';
      }
      r = null;
      return;
    }
    const dx = e.clientX - r.x0;
    const dy = e.clientY - r.y0;
    if (!r.active) {
      if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
      r.active = true;
      main.style.transition = 'none';
    }
    const y = rubber(dy);
    main.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
  });

  const end = (e) => {
    if (!r || e.pointerId !== r.id) return;
    const wasActive = r.active;
    r = null;
    if (!wasActive) return;
    suppressClickUntil = performance.now() + 260;
    ignoreClickUntil = performance.now() + 260;
    main.style.transition = 'transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)';
    main.style.transform = 'translate3d(0, 0, 0)';
  };
  main.addEventListener('pointerup', end);
  main.addEventListener('pointercancel', end);
  main.addEventListener('transitionend', () => {
    if (!r && main.style.transform === 'translate3d(0, 0, 0)') {
      main.style.transform = '';
      main.style.transition = '';
    }
  });
}

// ---------- 길게 눌러 끌어서 옮기기 · 바꾸기 ----------
// 사진 칸을 0.3초 누르고 있으면 사진이 떠오르고, 다른 칸에 놓으면
// 빈 칸이면 옮기고, 사진이 있으면 서로 바꾼다. 위치·확대·필터는 그대로 따라간다.

const HOLD_MS = 300;
let drag = null;
let ignoreClickUntil = 0;

function cellIndexAt(x, y) {
  const els = $('paper').querySelectorAll('.cell');
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
  }
  return -1;
}

function sameSize(a, b) {
  const A = layout.cells[a], B = layout.cells[b];
  return A && B && A.w === B.w && A.h === B.h;
}

function onPaperDown(e) {
  if (busy || drag || markMode) return;
  const i = cellIndexAt(e.clientX, e.clientY);
  if (i < 0 || !cells[i]) return;
  drag = { from: i, id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, over: -1, ghost: null };
  drag.timer = setTimeout(() => startDrag(e), HOLD_MS);
}

function startDrag(e) {
  if (!drag) return;
  drag.active = true;
  const btn = cellButton(drag.from);
  const r = btn.getBoundingClientRect();
  const g = document.createElement('canvas');
  g.width = Math.round(r.width * 2);
  g.height = Math.round(r.height * 2);
  g.getContext('2d').drawImage(cells[drag.from].preview, 0, 0, g.width, g.height);
  g.className = 'drag-ghost';
  g.style.width = `${r.width}px`;
  g.style.height = `${r.height}px`;
  drag.dx = drag.x0 - r.left;
  drag.dy = drag.y0 - r.top;
  // 0.3초 도달 시 사진이 부드럽게 떠오르는 짧은 애니메이션
  g.style.transform = `translate(${r.left}px, ${r.top}px) scale(1)`;
  g.style.transition = 'transform 0.14s ease-out';
  document.body.appendChild(g);
  g.offsetWidth;
  g.style.transform = `translate(${r.left}px, ${r.top}px) scale(1.08)`;
  drag.ghost = g;
  btn.classList.add('lifted');
  // 끄는 동안 아래 큰 버튼이 '휴지통'으로 바뀐다
  $('printBtn').classList.add('trash');
  $('mainIcon').innerHTML = iconSvg('trash');
  $('mainLabel').textContent = '여기로 끌어 비우기';
  try { $('paper').setPointerCapture(drag.id); } catch (err) { /* 없어도 동작 */ }
}

function onPaperMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.active) {
    // 누르고 바로 움직이면 끌기가 아니라 그냥 손가락이 미끄러진 것
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 10) cancelDrag();
    return;
  }
  drag.ghost.style.transition = 'none';
  drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px) scale(1.08)`;
  // 휴지통 위인지
  const tr = $('printBtn').getBoundingClientRect();
  const onTrash = e.clientX >= tr.left - 8 && e.clientX <= tr.right + 8 && e.clientY >= tr.top - 16 && e.clientY <= tr.bottom + 8;
  if (onTrash !== drag.onTrash) {
    drag.onTrash = onTrash;
    $('printBtn').classList.toggle('hot', onTrash);
    $('mainLabel').textContent = onTrash ? '놓으면 비워져요' : '여기로 끌어 비우기';
  }
  const over = onTrash ? -1 : cellIndexAt(e.clientX, e.clientY);
  if (over !== drag.over) {
    if (drag.over >= 0) cellButton(drag.over).classList.remove('drop-target');
    removeSwapPreview();
    drag.over = over >= 0 && over !== drag.from && !used[over] && sameSize(over, drag.from) ? over : -1;
    if (drag.over >= 0) {
      // 놓으면 무슨 일이 생기는지 미리 보여 준다: 사진이 있으면 '바꾸기', 비었으면 '옮기기'
      const t = cellButton(drag.over);
      t.dataset.drop = cells[drag.over] ? '바꾸기' : '옮기기';
      t.classList.add('drop-target');
      if (cells[drag.over]) showSwapPreview(drag.from, drag.over);
    }
  }
}

function onPaperUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { active, from, over, onTrash } = drag;
  cancelDrag();
  if (!active) return;
  ignoreClickUntil = performance.now() + 400;   // 놓는 순간의 '톡'이 편집 화면을 열지 않게
  if (onTrash) {
    clearCell(from);
    render();
    return;
  }
  if (over < 0) return;
  [cells[from], cells[over]] = [cells[over], cells[from]];
  lastPrinted = lastPrinted.filter((k) => k !== from && k !== over);
  render();
  scheduleSave();
}

// 바꾸기라면 상대 칸 사진이 원래 자리에 미리 와 있는 모습을 보여 준다
function showSwapPreview(from, to) {
  const btn = cellButton(from);
  const r = btn.getBoundingClientRect();
  const c = document.createElement('canvas');
  c.width = Math.round(r.width * 2);
  c.height = Math.round(r.height * 2);
  c.getContext('2d').drawImage(cells[to].preview, 0, 0, c.width, c.height);
  c.className = 'swap-preview';
  btn.appendChild(c);
}

function removeSwapPreview() {
  document.querySelectorAll('.swap-preview').forEach((c) => { freeCanvas(c); c.remove(); });
}

function cancelDrag() {
  if (!drag) return;
  removeSwapPreview();
  clearTimeout(drag.timer);
  const wasActive = drag.active;
  if (drag.ghost) { freeCanvas(drag.ghost); drag.ghost.remove(); }
  document.querySelectorAll('.cell.lifted, .cell.drop-target').forEach((b) => b.classList.remove('lifted', 'drop-target'));
  drag = null;
  if (wasActive) {
    $('printBtn').classList.remove('trash', 'hot');
    render();   // 아래 버튼을 원래대로 (사진 고르기 / PRINT)
  }
}

function onCellTap(i) {
  if (busy || performance.now() < ignoreClickUntil) return;
  targetCell = i;
  // 표시하기 중: 빈 칸을 누르면 사용함 켜고 끄기
  if (markMode) {
    if (cells[i]) { toast('사진이 있는 칸은 먼저 비워 주세요'); return; }
    used[i] = !used[i];
    render();
    return;
  }
  // 사용함 칸: 다시 쓸지 묻기
  if (!cells[i] && used[i]) {
    if (confirm(`${i + 1}번 칸을 다시 쓸까요?\n(아직 인쇄하지 않은 빈 칸일 때만)`)) {
      used[i] = false;
      render();
      scheduleSave();
    }
    return;
  }
  if (!cells[i]) {
    // 방금 인쇄한 칸이 남아 있으면 중복 인쇄를 막기 위해 먼저 이어 쓰기를 물어본다
    if (remainingAfterPrint() > 0) {
      openContinueSheet(true);
      return;
    }
    $('manyInput').click();   // 빈 칸: 여러 장 고르기 → 이 칸부터 채움
    return;
  }
  openEditor(i);              // 사진 있는 칸: 편집 화면
}

document.addEventListener('DOMContentLoaded', () => {
  applyPresetLabels();
  buildPresetMenu();
  $('paperChip').addEventListener('click', () => { if (!busy && !markMode) openSheet('presetMenu'); });
  $('presetMenu').addEventListener('click', (e) => { if (e.target.id === 'presetMenu') closeSheet('presetMenu'); });

  buildPaper();
  fitPaper();
  window.addEventListener('resize', fitPaper);
  if (window.visualViewport) visualViewport.addEventListener('resize', fitPaper);
  render();

  $('manyInput').addEventListener('change', (e) => {
    addFiles(e.target.files, emptySlotsFrom(targetCell ?? 0));
    e.target.value = '';   // 같은 사진을 다시 골라도 동작하게
  });
  $('oneInput').addEventListener('change', (e) => {
    addFiles(e.target.files, [targetCell]);
    e.target.value = '';
  });

  $('printBtn').addEventListener('click', onMainButton);
  $('paper').addEventListener('pointerdown', onPaperDown);
  $('paper').addEventListener('pointermove', onPaperMove);
  $('paper').addEventListener('pointerup', onPaperUp);
  $('paper').addEventListener('pointercancel', () => cancelDrag());
  $('newSheetBtn').addEventListener('click', newSheet);

  // 빈 칸만 인쇄
  $('markFromMenu').addEventListener('click', enterMarkMode);
  $('pfMarkBtn').addEventListener('click', enterMarkMode);
  $('continueGo').addEventListener('click', () => {
    const pickAfter = continueFromTap;
    continueFromTap = false;
    closeSheet('continueSheet');
    continueSheet();
    if (pickAfter) $('manyInput').click();
  });
  $('continueAdd').addEventListener('click', () => {
    continueFromTap = false;
    closeSheet('continueSheet');
    lastPrinted = [];
    scheduleSave();
    render();
    $('manyInput').click();
  });
  $('continueFresh').addEventListener('click', () => {
    const pickAfter = continueFromTap;
    continueFromTap = false;
    closeSheet('continueSheet');
    startFresh();
    if (pickAfter) { targetCell = 0; $('manyInput').click(); }
  });
  $('continueSheet').addEventListener('click', (e) => { if (e.target.id === 'continueSheet') closeSheet('continueSheet'); });

  // 바텀 시트 아래로 쓸어내려 닫기 + 기본 화면 고무줄 탄성 + PC Esc 키 닫기
  ['settings', 'presetMenu', 'continueSheet', 'preflight'].forEach(bindSheetSwipe);
  bindMainRubberBand();
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (Editor.isOpen()) { Editor.cancel(); return; }
    ['preflight', 'continueSheet', 'presetMenu', 'settings'].forEach((id) => {
      if (!$(id).hidden) closeSheet(id);
    });
  });

  // 앱을 나가거나 다른 화면으로 이동할 때 예약된 자동 저장을 즉시 실행
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveTimer) saveNow();
  });
  window.addEventListener('pagehide', () => {
    if (saveTimer) saveNow();
  });

  // 저장한 작업·사용함 표시를 아이폰이 정리하지 않도록 부탁 (거절돼도 앱은 그대로 동작)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // 설정 창
  $('settingsBtn').addEventListener('click', () => {
    $('setPreflight').checked = !skipPreflight();
    $('setPrintFix').checked = printFixEnabled();
    openSheet('settings');
  });
  $('settings').addEventListener('click', (e) => { if (e.target.id === 'settings') closeSheet('settings'); });
  $('setPreflight').addEventListener('change', (e) => setSkipPreflight(!e.target.checked));
  $('setPrintFix').addEventListener('change', (e) => { setPrintFixEnabled(e.target.checked); closeSheet('settings'); rerenderAll(); });
  $('calibRow').hidden = !preset.testSheet;

  $('appInfo').textContent = `${APP.name} v${APP.version} · ${APP.date.replace(/-/g, '.')}`;
  $('appCredit').textContent = `Made by ${APP.maker} for Hongido`;

  restore();

  // 오프라인에서도 열리게 (서비스 워커: 앱 파일을 기기에 보관해 두는 장치)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  $('preflightGo').addEventListener('click', () => {
    setSkipPreflight($('skipPreflight').checked);
    closeSheet('preflight');
    sendToPrint();
  });

  // 어두운 바깥을 누르면 닫기
  $('preflight').addEventListener('click', (e) => { if (e.target.id === 'preflight') closeSheet('preflight'); });
});
