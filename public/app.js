// app.js — 사진을 칸에 배치하고 인쇄 PDF 만들기

// 지금 쓰는 판형 (용지 칩을 눌러 바꿀 수 있음)
let presetId = getPresetId();
let preset = PRESETS[presetId];
let layout = layoutOf(preset);

// 칸마다 { source, edit, look, preview(캔버스), print: {bytes, pxW, pxH} 또는 null(만드는 중), ready(약속) } 또는 null
// edit = 사진 위치·배율·각도 (photo.js 참고), look = 필터 { id, amount } (filters.js 참고)
const NO_LOOK = { id: 'none', amount: 1 };
let cells = layout.cells.map(() => null);

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

// 칸 사진 만들기: 미리 보기가 나오면 바로 칸에 보여 주고, 인쇄용 JPEG는 뒤에서 기다린다
async function setCellPhoto(index, source, edit, look = NO_LOOK) {
  const job = renderCell(source, edit, layout.cells[index], look);
  const preview = await job.preview;
  const old = cells[index];
  if (old && old.source !== source) releaseSource(old.source);
  const entry = { source, edit, look, preview, print: null, ready: null };
  entry.ready = job.done.then((p) => { entry.print = p; return p; });
  entry.ready.catch(() => {});
  cells[index] = entry;
}

function clearCell(index) {
  const c = cells[index];
  if (c) releaseSource(c.source);
  cells[index] = null;
}

// 누른 칸부터 끝까지, 그다음 앞쪽의 빈 칸 순서
function emptySlotsFrom(start) {
  const n = cells.length;
  const order = [];
  for (let k = 0; k < n; k++) order.push((start + k) % n);
  return order.filter((i) => !cells[i]);
}

async function addFiles(files, slots) {
  if (busy || files.length === 0) return;
  const list = Array.from(files).slice(0, slots.length);
  setBusy(true, list.length > 1 ? `사진 넣는 중 1 / ${list.length}` : '사진 넣는 중');
  slots.slice(0, list.length).forEach((i) => cellButton(i).classList.add('loading'));
  render();
  let failed = 0;

  for (let k = 0; k < list.length; k++) {
    if (list.length > 1) $('busyText').textContent = `사진 넣는 중 ${k + 1} / ${list.length}`;
    const cell = layout.cells[slots[k]];
    try {
      const source = await loadSource(list[k], sourceMaxFor(cell));
      await setCellPhoto(slots[k], source, defaultEdit(source, cell));
    } catch (e) {
      failed++;
    }
    cellButton(slots[k]).classList.remove('loading');
    render();
  }

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
    await setCellPhoto(i, ci.source, i === index ? edit : ci.edit, look);
    cellButton(i).classList.remove('loading');
    render();
  }
  setBusy(false);
  render();
  if (applyAll && targets.length > 1) toast(`${targets.length}칸에 ${findFilter(look.id).name} 적용`);
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
    onDone: (edit, look, applyAll) => applyEdit(index, edit, look, applyAll),
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
  const file = new File([buildPrintPdf()], printFileName(), { type: 'application/pdf' });
  return sharePdf(file, UI.appTitle);
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
    btn.addEventListener('click', () => onCellTap(i));
    paper.appendChild(btn);
  });
}

function render() {
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
    btn.setAttribute('aria-label', c ? `${i + 1}번 칸 사진` : `${i + 1}번 칸 비어 있음, 사진 고르기`);
  });
  const count = cells.filter(Boolean).length;
  $('countChip').textContent = `${count} / ${cells.length}`;
  $('emptyHint').classList.toggle('show', count === 0 && !busy);
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
  kept.slice(room).forEach((c) => releaseSource(c.source));
  presetId = id;
  preset = next;
  layout = nextLayout;
  cells = layout.cells.map(() => null);
  setPresetId(id);
  applyPresetLabels();
  syncPresetMenu();
  buildPaper();
  fitPaper();
  render();
  // 남길 사진을 새 칸 크기에 맞춰 다시 만든다 (필터는 그대로)
  const move = kept.slice(0, room);
  if (move.length) {
    setBusy(true, '용지에 맞추는 중');
    move.forEach((_, i) => cellButton(i).classList.add('loading'));
    for (let i = 0; i < move.length; i++) {
      let src = move[i].source;
      // 새 칸이 더 큰 사진을 필요로 하면 원본 파일에서 다시 만든다
      const need = sourceMaxFor(layout.cells[i]);
      if (need > src.maxPx && src.file) {
        try {
          const fresh = await loadSource(src.file, need);
          releaseSource(src);
          src = fresh;
        } catch (e) { /* 실패하면 있던 크기로 */ }
      }
      await setCellPhoto(i, src, defaultEdit(src, layout.cells[i]), move[i].look);
      cellButton(i).classList.remove('loading');
      render();
    }
    setBusy(false);
    render();
  }
  toast(`${next.menuTitle}로 바꿨어요`);
}

function openSheet(id) {
  $(id).hidden = false;
}

function closeSheet(id) {
  $(id).hidden = true;
}

function onCellTap(i) {
  if (busy) return;
  targetCell = i;
  if (!cells[i]) {
    $('manyInput').click();   // 빈 칸: 여러 장 고르기 → 이 칸부터 채움
    return;
  }
  openEditor(i);              // 사진 있는 칸: 편집 화면
}

document.addEventListener('DOMContentLoaded', () => {
  $('appTitle').textContent = UI.appTitle;
  applyPresetLabels();
  buildPresetMenu();
  $('paperChip').addEventListener('click', () => openSheet('presetMenu'));
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

  $('printBtn').addEventListener('click', onPrint);
  $('preflightGo').addEventListener('click', () => {
    setSkipPreflight($('skipPreflight').checked);
    closeSheet('preflight');
    sendToPrint();
  });

  // 어두운 바깥을 누르면 닫기
  $('preflight').addEventListener('click', (e) => { if (e.target.id === 'preflight') closeSheet('preflight'); });
});
