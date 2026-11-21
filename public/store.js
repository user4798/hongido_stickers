// store.js — 작업 자동 저장 (IndexedDB: 브라우저 안의 큰 저장 공간. 사진은 기기 밖으로 나가지 않는다)
// 저장 구조(v2): 원본 사진 파일(수 MB)은 파일별 키('f:ID')로 한 번만 저장하고,
//               위치·필터·사용함 같은 가벼운 설정(수 KB)만 'current'에 덮어쓴다.
//               예전 방식(v1)으로 저장된 작업도 그대로 불러온다.

const Store = (() => {
  const DB = 'hongido';
  const TABLE = 'state';
  const KEY = 'current';
  const FILE_PREFIX = 'f:';
  let dbPromise = null;
  let savedFiles = new Set();     // 이미 IndexedDB에 들어 있는 사진 ID 목록
  let queue = Promise.resolve();  // 쓰기 순서 보장

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('no-idb')); return; }
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(TABLE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function enqueue(fn) {
    queue = queue.then(fn, fn);
    return queue;
  }

  function save(state) {
    return enqueue(() => open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(TABLE, 'readwrite');
      const t = tx.objectStore(TABLE);
      const needed = new Set();

      (state.cells || []).forEach((c) => {
        if (!c || !c.file || !c.fileId) return;
        needed.add(c.fileId);
        // 아직 저장되지 않은 새 사진 파일만 저장 (이미 있으면 건너뜀)
        if (!savedFiles.has(c.fileId)) t.put(c.file, FILE_PREFIX + c.fileId);
      });

      // 더 이상 쓰지 않는 예전 사진 파일 정리
      for (const oldId of savedFiles) {
        if (!needed.has(oldId)) t.delete(FILE_PREFIX + oldId);
      }

      // 가벼운 작업 정보만 덮어쓰기
      t.put({
        v: 2,
        presetId: state.presetId,
        cells: (state.cells || []).map((c) => (c && c.fileId ? { fileId: c.fileId, edit: c.edit, look: c.look } : null)),
        used: state.used,
        lastPrinted: state.lastPrinted,
      }, KEY);

      tx.oncomplete = () => { savedFiles = needed; resolve(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }))).catch(() => {});
  }

  function load() {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(TABLE, 'readonly');
      const t = tx.objectStore(TABLE);
      const curReq = t.get(KEY);
      const keysReq = t.getAllKeys ? t.getAllKeys() : null;
      const fileReqs = [];
      let cur = null;

      curReq.onsuccess = () => {
        cur = curReq.result;
        if (cur && cur.v === 2 && Array.isArray(cur.cells)) {
          cur.cells.forEach((c, i) => {
            if (c && c.fileId) fileReqs[i] = t.get(FILE_PREFIX + c.fileId);
          });
        }
      };

      tx.oncomplete = () => {
        const known = new Set();
        if (keysReq && Array.isArray(keysReq.result)) {
          keysReq.result.forEach((k) => {
            if (typeof k === 'string' && k.startsWith(FILE_PREFIX)) known.add(k.slice(FILE_PREFIX.length));
          });
        }
        savedFiles = known;

        if (!cur) { resolve(null); return; }
        if (cur.v === 2 && Array.isArray(cur.cells)) {
          resolve({
            ...cur,
            cells: cur.cells.map((c, i) => {
              const file = fileReqs[i] && fileReqs[i].result;
              return c && file ? { fileId: c.fileId, file, edit: c.edit, look: c.look } : null;
            }),
          });
          return;
        }
        // 예전 v1 형식 호환: 셀 안에 file이 바로 들어 있음
        resolve(cur);
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    })).catch(() => null);
  }

  function clear() {
    return enqueue(() => open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(TABLE, 'readwrite');
      tx.objectStore(TABLE).clear();
      tx.oncomplete = () => { savedFiles = new Set(); resolve(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }))).catch(() => {});
  }

  return { save, load, clear };
})();
