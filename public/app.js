// app.js — 사진을 칸에 배치하고 인쇄 PDF 만들기

const preset = PRESETS[DEFAULT_PRESET];
const layout = layoutOf(preset);

// 칸마다 { source, edit, look, print: {blob, bytes, pxW, pxH}, previewUrl } 또는 null
// edit = 사진 위치·배율·각도 (photo.js 참고), look = 필터 { id, amount } (filters.js 참고)
const NO_LOOK = { id: 'none', amount: 1 };
const cells = layout.cells.map(() => null);

let busy = false;
let targetCell = null;   // 마지막으로 누른 칸 번호 (0부터)

const $ = (id) => document.getElementById(id);

// ---------- 칸 채우기 ----------

async function setCellPhoto(index, source, edit, look = NO_LOOK) {
  const print = await renderForCell(source, edit, layout.cells[index], look);
  clearCell(index);
  cells[index] = { source, edit, look, print, previewUrl: URL.createObjectURL(print.blob) };
}

function clearCell(index) {
  const c = cells[index];
  if (c) URL.revokeObjectURL(c.previewUrl);
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
  busy = true;
  const list = Array.from(files).slice(0, slots.length);
  slots.slice(0, list.length).forEach((i) => cellButton(i).classList.add('loading'));
  render();
  let failed = 0;

  for (let k = 0; k < list.length; k++) {
    try {
      const source = await loadSource(list[k]);
      await setCellPhoto(slots[k], source, defaultEdit(source, layout.cells[slots[k]]));
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
  busy = false;
  render();
}

// 편집 화면에서 '완료'를 누르면 그 위치·필터대로 칸 사진을 다시 만든다.
// applyAll이면 같은 필터를 사진이 든 다른 칸에도 적용한다.
async function applyEdit(index, edit, look, applyAll) {
  const c = cells[index];
  if (!c) return;
  busy = true;
  const targets = applyAll ? cells.map((x, i) => (x ? i : -1)).filter((i) => i >= 0) : [index];
  targets.forEach((i) => cellButton(i).classList.add('loading'));
  for (const i of targets) {
    const ci = cells[i];
    await setCellPhoto(i, ci.source, i === index ? edit : ci.edit, look);
    cellButton(i).classList.remove('loading');
    render();
  }
  busy = false;
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
    sticker: preset.sticker,
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
  return `${preset.label}_${preset.printPaper}_${preset.printScale}.pdf`;
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

function onPrint() {
  if (busy) return;
  if (!cells.some(Boolean)) {
    toast('먼저 칸을 눌러 사진을 넣어 주세요');
    return;
  }
  if (skipPreflight()) {
    sendToPrint();
    return;
  }
  $('skipPreflight').checked = false;
  openSheet('preflight');
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
    btn.style.backgroundImage = c ? `url("${c.previewUrl}")` : '';
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
  $('paperChip').textContent = `${preset.label} · ${preset.printPaper}`;
  $('preflightPaper').textContent = `${preset.label} 스티커 용지`;
  $('pfPaper').textContent = preset.printPaper;
  $('pfScale').textContent = preset.printScale;

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
