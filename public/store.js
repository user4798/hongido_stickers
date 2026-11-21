// store.js — 작업 자동 저장 (IndexedDB: 브라우저 안의 큰 저장 공간. 사진은 기기 밖으로 나가지 않는다)
// 저장하는 것: 지금 판형, 칸마다 원본 사진 파일·위치(edit)·필터(look)
// 앱을 다시 열면(새로고침, 다른 앱 다녀오기, 설정 다녀오기) 그대로 돌아온다.

const Store = (() => {
  const DB = 'hongido';
  const TABLE = 'state';
  const KEY = 'current';
  let dbPromise = null;

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

  function run(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(TABLE, mode);
      const req = fn(tx.objectStore(TABLE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  return {
    save: (state) => run('readwrite', (t) => t.put(state, KEY)).catch(() => {}),
    load: () => run('readonly', (t) => t.get(KEY)).catch(() => null),
    clear: () => run('readwrite', (t) => t.delete(KEY)).catch(() => {}),
  };
})();
