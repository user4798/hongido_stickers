// app.js — 2단계: 사진을 칸에 배치하고 인쇄 PDF 만들기

const preset = PRESETS[DEFAULT_PRESET];
const layout = layoutOf(preset);

// 칸마다 { source, rotation, print: {blob, bytes, pxW, pxH}, previewUrl } 또는 null
const cells = layout.cells.map(() => null);

let busy = false;
let targetCell = null;   // 칸 메뉴에서 고른 칸 번호 (0부터)

const $ = (id) => document.getElementById(id);

// ---------- 칸 채우기 ----------

async function setCellPhoto(index, source, rotation) {
  const cell = layout.cells[index];
  const print = await renderForCell(source, rotation, cell);
  clearCell(index);
  cells[index] = { source, rotation, print, previewUrl: URL.createObjectURL(print.blob) };
}

function clearCell(index) {
  const c = cells[index];
  if (c) URL.revokeObjectURL(c.previewUrl);
  cells[index] = null;
}

async function addFiles(files, onlyIndex) {
  if (busy || files.length === 0) return;
  busy = true;
  // 넣을 칸: 특정 칸(바꾸기) 또는 빈 칸들을 순서대로
  const slots = onlyIndex != null
    ? [onlyIndex]
    : cells.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  const list = Array.from(files).slice(0, slots.length);
  let failed = 0;

  for (let k = 0; k < list.length; k++) {
    showStatus(`사진 넣는 중… ${k + 1} / ${list.length}`);
    try {
      const source = await loadSource(list[k]);
      await setCellPhoto(slots[k], source, defaultRotation(source, layout.cells[slots[k]]));
      render();
    } catch (e) {
      failed++;
    }
  }

  const skipped = files.length - list.length;
  const notes = [];
  if (skipped > 0) notes.push(`빈 칸이 ${slots.length}개라 ${skipped}장은 넣지 못했어요.`);
  if (failed > 0) notes.push(`${failed}장은 열 수 없는 사진이었어요.`);
  showStatus(notes.join(' '));
  busy = false;
  render();
}

async function rotateCell(index) {
  const c = cells[index];
  if (!c || busy) return;
  busy = true;
  await setCellPhoto(index, c.source, (c.rotation + 90) % 360);
  busy = false;
  render();
}

// ---------- 인쇄 PDF ----------

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

function printPdf() {
  if (!cells.some(Boolean)) return;
  const file = new File([buildPrintPdf()], 'stickit.pdf', { type: 'application/pdf' });
  return sharePdf(file, '스티커 인쇄');
}

// ---------- 화면 ----------

function pct(v, total) {
  return `${(v / total) * 100}%`;
}

function buildSheet() {
  const sheet = $('sheet');
  sheet.style.aspectRatio = `${preset.paper.w} / ${preset.paper.h}`;
  layout.cells.forEach((cell, i) => {
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.style.left = pct(cell.x, preset.paper.w);
    btn.style.top = pct(cell.y, preset.paper.h);
    btn.style.width = pct(cell.w, preset.paper.w);
    btn.style.height = pct(cell.h, preset.paper.h);
    btn.addEventListener('click', () => onCellTap(i));
    sheet.appendChild(btn);
  });
}

function render() {
  const buttons = $('sheet').querySelectorAll('.cell');
  buttons.forEach((btn, i) => {
    const c = cells[i];
    btn.classList.toggle('filled', !!c);
    btn.style.backgroundImage = c ? `url("${c.previewUrl}")` : '';
    btn.setAttribute('aria-label', c ? `${i + 1}번 칸 사진` : `${i + 1}번 칸 비어 있음`);
    btn.textContent = c ? '' : '+';
  });
  const count = cells.filter(Boolean).length;
  $('printBtn').disabled = count === 0 || busy;
  $('pickBtn').disabled = busy || count === cells.length;
  $('pickBtn').textContent = count === 0 ? '사진 고르기' : count === cells.length ? '9칸이 다 찼어요' : '사진 더 넣기';
  $('countNote').textContent = `${count} / ${cells.length}칸`;
}

function showStatus(text) {
  $('status').textContent = text;
}

function onCellTap(i) {
  if (busy) return;
  targetCell = i;
  showStatus('');
  if (!cells[i]) {
    $('oneInput').click();   // 빈 칸: 바로 사진 고르기
    return;
  }
  $('menuTitle').textContent = `${i + 1}번 칸`;
  $('menu').hidden = false;
}

function closeMenu() {
  $('menu').hidden = true;
}

document.addEventListener('DOMContentLoaded', () => {
  buildSheet();
  render();

  $('pickBtn').addEventListener('click', () => $('manyInput').click());
  $('manyInput').addEventListener('change', (e) => {
    addFiles(e.target.files, null);
    e.target.value = '';   // 같은 사진을 다시 골라도 동작하게
  });
  $('oneInput').addEventListener('change', (e) => {
    addFiles(e.target.files, targetCell);
    e.target.value = '';
  });

  $('printBtn').addEventListener('click', printPdf);

  $('menuReplace').addEventListener('click', () => { closeMenu(); $('oneInput').click(); });
  $('menuRotate').addEventListener('click', () => { closeMenu(); rotateCell(targetCell); });
  $('menuClear').addEventListener('click', () => { closeMenu(); clearCell(targetCell); render(); });
  $('menuClose').addEventListener('click', closeMenu);
  $('menu').addEventListener('click', (e) => { if (e.target.id === 'menu') closeMenu(); });
});
