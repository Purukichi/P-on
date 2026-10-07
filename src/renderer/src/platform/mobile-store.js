const empty = () => ({ tracks: [], playlists: [], albumCovers: {}, albumArtists: {} })

/** One atomic IndexedDB record: metadata and audio Blobs commit together. */
export function createMobileStore(name = 'p-on-mobile-v2') {
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('library')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('別の画面を閉じてから、もう一度起動してください'))
  })
  let pending = Promise.resolve()
  async function read() {
    const db = await database
    return new Promise((resolve, reject) => {
      const request = db.transaction('library').objectStore('library').get('state')
      request.onsuccess = () => resolve(request.result ?? empty())
      request.onerror = () => reject(request.error)
    })
  }
  async function write(state) {
    const db = await database
    await new Promise((resolve, reject) => {
      const tx = db.transaction('library', 'readwrite')
      tx.objectStore('library').put(state, 'state')
      tx.oncomplete = resolve
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('保存できませんでした'))
    })
  }
  return {
    read: async () => { await pending; return read() },
    update(change) {
      const next = pending.then(async () => {
        const state = await read()
        const result = await change(state)
        await write(state)
        return result
      })
      pending = next.catch(() => {})
      return next
    },
    async close() { await pending; (await database).close() }
  }
}
