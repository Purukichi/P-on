/**
 * 測ったラウドネスを端末に残しておく場所（IndexedDB）。
 *
 * アルバム単位の補正のためにブロックの分布まで持つので、1 曲 1〜2 KB になる。
 * 曲数が多いと localStorage の上限（数 MB）に届くため、こちらに置いている。
 * 開けない環境（プライベートモードなど）では、起動している間だけ覚えておく。
 */

const DB_NAME = 'p-on-loudness'
const STORE = 'tracks'

/**
 * @returns {Promise<{entries: Map<string, object>, put: (key: string, value: object) => void, remove: (key: string) => void}>}
 */
export async function openLoudnessStore(indexedDB = globalThis.indexedDB) {
  const db = await openDatabase(indexedDB).catch((error) => {
    console.warn('[loudness] 測定結果を保存できないので、起動中だけ覚えておきます:', error)
    return null
  })
  const entries = db ? await readAll(db).catch(() => new Map()) : new Map()

  return {
    entries,
    put(key, value) {
      entries.set(key, value)
      if (db) write(db, (store) => store.put(value, key))
    },
    remove(key) {
      entries.delete(key)
      if (db) write(db, (store) => store.delete(key))
    }
  }
}

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new Error('IndexedDB がありません'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function readAll(db) {
  return new Promise((resolve, reject) => {
    const entries = new Map()
    const request = db.transaction(STORE).objectStore(STORE).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return resolve(entries)
      entries.set(String(cursor.key), cursor.value)
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
}

function write(db, operation) {
  try {
    const transaction = db.transaction(STORE, 'readwrite')
    operation(transaction.objectStore(STORE))
    transaction.onerror = () => console.warn('[loudness] 保存に失敗しました:', transaction.error)
  } catch (error) {
    console.warn('[loudness] 保存に失敗しました:', error)
  }
}
