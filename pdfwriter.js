// pdfwriter.js — 아주 작은 PDF 만들기 도구.
// 좌표는 모두 mm이고, 종이 왼쪽 위가 (0, 0), 오른쪽·아래로 갈수록 커진다.
// (PDF 내부는 pt 단위·왼쪽 아래 기준이라 여기서 바꿔 준다. 1pt = 25.4/72 mm)

const MM_TO_PT = 72 / 25.4;

function fmt(n) {
  // 소수 셋째 자리까지, 불필요한 0 제거
  return (Math.round(n * 1000) / 1000).toString();
}

class PdfDoc {
  constructor(widthMm, heightMm) {
    this.w = widthMm;
    this.h = heightMm;
    this.pages = [];
    this.addPage();
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
  }

  // mm → pt 좌표 변환
  X(mm) { return fmt(mm * MM_TO_PT); }
  Y(mm) { return fmt((this.h - mm) * MM_TO_PT); }
  L(mm) { return fmt(mm * MM_TO_PT); }

  lineWidth(mm) { this.ops.push(`${this.L(mm)} w`); }
  gray(g) { this.ops.push(`${fmt(g)} G ${fmt(g)} g`); }   // 0 = 검정, 1 = 흰색
  dash(onMm, offMm) { this.ops.push(`[${this.L(onMm)} ${this.L(offMm)}] 0 d`); }
  solid() { this.ops.push('[] 0 d'); }

  line(x1, y1, x2, y2) {
    this.ops.push(`${this.X(x1)} ${this.Y(y1)} m ${this.X(x2)} ${this.Y(y2)} l S`);
  }

  rect(x, y, w, h) {
    this.ops.push(`${this.X(x)} ${this.Y(y + h)} ${this.L(w)} ${this.L(h)} re S`);
  }

  // 영문·숫자만 지원 (Helvetica 기본 글꼴). align: 'left' | 'center' | 'right'
  // y는 글자 아랫선(baseline) 위치.
  text(x, y, str, sizePt, align = 'left') {
    const safe = String(str).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
    const widthMm = this.textWidth(str, sizePt);
    let left = x;
    if (align === 'center') left = x - widthMm / 2;
    if (align === 'right') left = x - widthMm;
    this.ops.push(`BT /F1 ${fmt(sizePt)} Tf ${this.X(left)} ${this.Y(y)} Td (${safe}) Tj ET`);
  }

  // 대략적인 글자 폭 (Helvetica 평균 폭 0.556em 기준, 숫자는 정확)
  textWidth(str, sizePt) {
    return String(str).length * 0.556 * sizePt / MM_TO_PT;
  }

  toBlob() {
    const parts = [];
    const offsets = [];
    let length = 0;
    const push = (s) => { parts.push(s); length += s.length; }; // 모두 ASCII라 글자 수 = 바이트 수

    const pageCount = this.pages.length;
    // 객체 번호: 1 Catalog, 2 Pages, 3 Font, 이후 페이지마다 (Page, Content) 2개씩
    const pageObj = (i) => 4 + i * 2;
    const contentObj = (i) => 5 + i * 2;
    const total = 3 + pageCount * 2;

    const obj = (num, body) => {
      offsets[num] = length;
      push(`${num} 0 obj\n${body}\nendobj\n`);
    };

    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const kids = this.pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

    const box = `[0 0 ${this.L(this.w)} ${this.L(this.h)}]`;
    this.pages.forEach((ops, i) => {
      obj(pageObj(i),
        `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /CropBox ${box} /TrimBox ${box} ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj(i)} 0 R >>`);
      const stream = ops.join('\n');
      obj(contentObj(i), `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });

    const xrefAt = length;
    let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= total; n++) {
      xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

    return new Blob(parts, { type: 'application/pdf' });
  }
}
