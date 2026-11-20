// config.js — 모든 길이(mm)를 모아 두는 곳.
// 용지 규격을 바꾸려면 이 파일만 고치면 된다. 다른 파일에는 mm 숫자를 직접 쓰지 않는다.

const PRESETS = {
  aone29602: {
    name: '에이원 29602 (엽서 3×3)',
    label: 'Aone29602',                 // 화면 칩·PDF 파일 이름에 쓰는 짧은 용지 이름
    printPaper: '엽서',                 // 아이폰 인쇄 화면에서 고를 용지 크기
    printScale: '100%',                 // 아이폰 인쇄 화면의 배율
    paper: { w: 100, h: 148 },          // 용지 크기
    margin: { top: 18.7, left: 7 },     // 첫 칸까지의 거리 (오른쪽·아래 마진은 계산으로 나옴)
                                        // top 18.7: 칼선 실측(위 20 ~ 아래 51.4mm)의 가운데에 칸을 맞춘 값
    grid: { cols: 3, rows: 3 },         // 칸 배열
    cell: { w: 26, h: 34 },             // 칸(사진이 들어갈 영역) 크기
    gap: { x: 4, y: 4 },                // 칸 사이 간격
    sticker: { w: 24, h: 32 },          // 제품에 적힌 스티커 크기 (참고용, 칸 가운데에 있다고 가정)
  },
};

const DEFAULT_PRESET = 'aone29602';

// 화면 설정
const UI = {
  appTitle: 'Hongido_Stickers',
  skipPreflightKey: 'stickit.skipPreflight.v1',   // '다음부터 바로 인쇄'를 기억하는 이름
  toastMs: 2600,                                  // 짧은 안내가 떠 있는 시간
};

// 사진 처리
const PHOTO = {
  dpi: 300,              // 인쇄 해상도 (칸 26×34mm → 약 307×402 픽셀)
  jpegQuality: 0.92,     // 칸에 맞춘 사진을 저장할 때 압축 품질 (0~1)
  sourceMaxPx: 2400,     // 원본 사진은 긴 쪽을 이 픽셀까지 줄여서 보관 (확대 화질과 아이폰 메모리 사이 균형)
  sourceQuality: 0.9,
  maxZoom: 4,            // 편집 화면 최대 확대 (칸을 꽉 채운 크기의 4배)
  snapDeg: 3,            // 0°·90°·180°·270°에서 이 각도 안이면 똑바로 붙음
};

// 시험 인쇄 PDF에만 쓰는 값
const TEST_SHEET = {
  lineWidth: 0.2,        // 칸 테두리 굵기
  thinLineWidth: 0.1,    // 눈금·참고선 굵기
  crossSize: 2,          // 칸 가운데 십자 크기
  ruler: {
    // 가로 눈금자: 아래 여백에 0~90mm
    hY: 132,             // 눈금자 기준선의 위치(위에서부터)
    hFrom: 5,
    hLength: 90,
    // 세로 눈금자: 왼쪽 여백에 위 마진부터 100mm (눈금은 기준선에서 오른쪽으로)
    vX: 3.5,             // 기준선의 위치(왼쪽에서부터)
    vLength: 100,
    tick1: 1,            // 1mm 눈금 길이
    tick5: 1.6,          // 5mm 눈금 길이
    tick10: 2.5,         // 10mm 눈금 길이
  },
  fontSizePt: 6,         // PDF 글자 크기 (pt, 1pt ≈ 0.35mm)
  labelGap: 1,           // 눈금과 숫자 사이 거리
  infoY: [138.5, 142],     // 안내 글자 두 줄의 위치(위에서부터)
};

// 보정값 조정 단위와 허용 범위
const CALIBRATION = {
  step: 0.1,
  min: -10,
  max: 10,
  storageKey: 'stickit.calibration.v1',
};

// 파생 값 계산: 칸 위치, 오른쪽·아래 마진
function layoutOf(preset) {
  const p = preset;
  const usedW = p.cell.w * p.grid.cols + p.gap.x * (p.grid.cols - 1);
  const usedH = p.cell.h * p.grid.rows + p.gap.y * (p.grid.rows - 1);
  const cells = [];
  for (let r = 0; r < p.grid.rows; r++) {
    for (let c = 0; c < p.grid.cols; c++) {
      cells.push({
        row: r,
        col: c,
        x: p.margin.left + c * (p.cell.w + p.gap.x),
        y: p.margin.top + r * (p.cell.h + p.gap.y),
        w: p.cell.w,
        h: p.cell.h,
      });
    }
  }
  return {
    cells,
    marginRight: p.paper.w - p.margin.left - usedW,
    marginBottom: p.paper.h - p.margin.top - usedH,
  };
}
