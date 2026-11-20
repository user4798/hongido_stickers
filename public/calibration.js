// calibration.js — 프린터 보정값 저장/불러오기 (시험 인쇄 화면과 사진 화면이 함께 씀)
// localStorage: 이 기기 브라우저 안에 작은 값을 기억해 두는 저장 공간

// 보정값은 판형마다 따로 저장 (첫 판형은 예전 이름 그대로 써서 기존 값을 잇는다)
function calibrationKey() {
  const id = getPresetId();
  return id === 'aone29602' ? CALIBRATION.storageKey : `${CALIBRATION.storageKey}.${id}`;
}

function loadCalibration() {
  try {
    const saved = JSON.parse(localStorage.getItem(calibrationKey()));
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return saved;
  } catch (e) { /* 저장 공간을 못 쓰는 경우(개인정보 보호 모드 등) 기본값 사용 */ }
  return { x: 0, y: 0 };
}

function saveCalibration(cal) {
  try {
    localStorage.setItem(calibrationKey(), JSON.stringify(cal));
    return true;
  } catch (e) {
    return false;
  }
}

function clampCalibration(v) {
  const rounded = Math.round(v / CALIBRATION.step) * CALIBRATION.step;
  return Math.min(CALIBRATION.max, Math.max(CALIBRATION.min, Math.round(rounded * 10) / 10));
}

function signedMm(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(1);
}

// PDF를 아이폰 공유 화면(프린트·캐논 앱)으로 보내거나, 안 되면 새 탭으로 연다.
function openPdf(file) {
  const url = URL.createObjectURL(file);
  const win = window.open(url, '_blank');
  if (!win) location.href = url; // 새 창이 막히면 현재 창에서 열기
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function sharePdf(file, title) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // 사용자가 닫음
    }
  }
  openPdf(file);
}
