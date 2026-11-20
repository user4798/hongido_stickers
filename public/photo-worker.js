// photo-worker.js — 화면과 따로 도는 사진 처리 작업자 (웹 워커)
// 칸 크기로 그리기 → 필터·인쇄 보정 → 미리 보기 돌려주기 → JPEG 만들어 돌려주기
// 이 일을 화면 쪽에서 하면 그동안 화면이 멈추고 터치가 밀린다.

importScripts('config.js', 'filters.js', 'photo.js');

self.onmessage = async (e) => {
  const { id, bitmap, w, h, edit, cell, look, printFix } = e.data;
  try {
    const { pxW, pxH } = cellPx(cell);
    const canvas = new OffscreenCanvas(pxW, pxH);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no-2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, pxW, pxH);
    ctx.imageSmoothingQuality = 'high';
    drawEdited(ctx, bitmap, { w, h }, edit);
    bitmap.close();
    applyLook(ctx, pxW, pxH, look, printFix, 'print');

    // 1) 칸에 바로 보여 줄 그림
    const preview = await createImageBitmap(canvas);
    self.postMessage({ id, type: 'preview', bitmap: preview }, [preview]);

    // 2) PDF에 넣을 JPEG
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: PHOTO.jpegQuality });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    self.postMessage({ id, type: 'done', bytes, pxW, pxH }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err && err.message || err) });
  }
};
