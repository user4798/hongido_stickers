// test.js — 시험 인쇄 PDF 만들기 + 보정값 조정 (1단계)

const preset = PRESETS[DEFAULT_PRESET];
const layout = layoutOf(preset);
const clamp = clampCalibration;
const signed = signedMm;

let cal = loadCalibration();

// ---------- 시험 인쇄 PDF ----------

function buildTestPdf(calibration) {
  const T = TEST_SHEET;
  const R = T.ruler;
  const dx = calibration.x;
  const dy = calibration.y;
  const doc = new PdfDoc(preset.paper.w, preset.paper.h);

  // 보정값만큼 모든 그림을 옮겨 그리는 도우미
  const line = (x1, y1, x2, y2) => doc.line(x1 + dx, y1 + dy, x2 + dx, y2 + dy);
  const rect = (x, y, w, h) => doc.rect(x + dx, y + dy, w, h);
  const text = (x, y, s, align) => doc.text(x + dx, y + dy, s, T.fontSizePt, align);

  // 1) 칸 테두리 (실선) + 칸 번호 + 가운데 십자
  doc.gray(0);
  doc.lineWidth(T.lineWidth);
  layout.cells.forEach((c, i) => {
    rect(c.x, c.y, c.w, c.h);
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    line(cx - T.crossSize, cy, cx + T.crossSize, cy);
    line(cx, cy - T.crossSize, cx, cy + T.crossSize);
    text(cx, cy + T.crossSize + 3, String(i + 1), 'center');
  });

  // 2) 제품 표기 스티커 크기 (점선, 칸 가운데라고 가정한 참고선)
  doc.gray(0.5);
  doc.lineWidth(T.thinLineWidth);
  doc.dash(0.6, 0.6);
  const sx = (preset.cell.w - preset.sticker.w) / 2;
  const sy = (preset.cell.h - preset.sticker.h) / 2;
  layout.cells.forEach((c) => rect(c.x + sx, c.y + sy, preset.sticker.w, preset.sticker.h));
  doc.solid();
  doc.gray(0);

  // 3) 가로 눈금자 (아래 여백): 기준선 + 위쪽으로 눈금 + 10mm마다 숫자
  doc.lineWidth(T.thinLineWidth);
  line(R.hFrom, R.hY, R.hFrom + R.hLength, R.hY);
  for (let i = 0; i <= R.hLength; i++) {
    const len = i % 10 === 0 ? R.tick10 : i % 5 === 0 ? R.tick5 : R.tick1;
    const x = R.hFrom + i;
    line(x, R.hY, x, R.hY - len);
    if (i % 10 === 0) text(x, R.hY + T.labelGap + 2, String(i), 'center');
  }

  // 4) 세로 눈금자 (왼쪽 여백): 첫 칸 위쪽과 같은 높이에서 시작, 오른쪽으로 눈금
  const vTop = preset.margin.top;
  line(R.vX, vTop, R.vX, vTop + R.vLength);
  for (let i = 0; i <= R.vLength; i++) {
    const len = i % 10 === 0 ? R.tick10 : i % 5 === 0 ? R.tick5 : R.tick1;
    const y = vTop + i;
    line(R.vX, y, R.vX + len, y);
  }

  // 5) 안내 글자 (영문)
  const m = preset.margin;
  text(R.hFrom, T.infoY[0],
    `A-one 29602 TEST   X ${signed(dx)} / Y ${signed(dy)} mm   PRINT 100%`);
  text(R.hFrom, T.infoY[1],
    `Expect: left ${m.left} mm, top ${m.top} mm, cell ${preset.cell.w}x${preset.cell.h}, ruler ${R.hLength} mm`);

  return doc.toBlob();
}

// ---------- 화면 ----------

const $ = (id) => document.getElementById(id);

function render() {
  $('calX').textContent = signed(cal.x) + ' mm';
  $('calY').textContent = signed(cal.y) + ' mm';
}

function setCal(next) {
  cal = { x: clamp(next.x), y: clamp(next.y) };
  const ok = saveCalibration(cal);
  $('saveNote').textContent = ok ? '보정값이 이 기기에 저장됐어요.' : '이 브라우저에서는 저장이 안 돼요. (개인정보 보호 모드인지 확인)';
  render();
}

function makePdfFile() {
  const blob = buildTestPdf(cal);
  return new File([blob], 'stickit-test.pdf', { type: 'application/pdf' });
}

function printPdf() {
  return sharePdf(makePdfFile(), '시험 인쇄');
}

function applyMeasured() {
  const mx = parseFloat($('measX').value);
  const my = parseFloat($('measY').value);
  const next = { ...cal };
  // 실제로 잰 값이 기대값보다 크면 그만큼 반대로(왼쪽/위로) 옮긴다.
  if (!Number.isNaN(mx)) next.x = cal.x - (mx - preset.margin.left);
  if (!Number.isNaN(my)) next.y = cal.y - (my - preset.margin.top);
  setCal(next);
  $('measX').value = '';
  $('measY').value = '';
}

document.addEventListener('DOMContentLoaded', () => {
  $('expectX').textContent = preset.margin.left;
  $('expectY').textContent = preset.margin.top;
  $('presetName').textContent = preset.name;

  $('printBtn').addEventListener('click', printPdf);
  $('previewBtn').addEventListener('click', () => openPdf(makePdfFile()));
  $('xMinus').addEventListener('click', () => setCal({ x: cal.x - CALIBRATION.step, y: cal.y }));
  $('xPlus').addEventListener('click', () => setCal({ x: cal.x + CALIBRATION.step, y: cal.y }));
  $('yMinus').addEventListener('click', () => setCal({ x: cal.x, y: cal.y - CALIBRATION.step }));
  $('yPlus').addEventListener('click', () => setCal({ x: cal.x, y: cal.y + CALIBRATION.step }));
  $('resetBtn').addEventListener('click', () => setCal({ x: 0, y: 0 }));
  $('applyBtn').addEventListener('click', applyMeasured);

  render();
});
