/** アプリ内でトラックをドラッグするときの MIME 型 */
export const TRACK_MIME = 'application/x-hamon-track'
/** コレクション（アルバム / シングル / プレイリスト）をドラッグするときの MIME 型 */
export const COLLECTION_MIME = 'application/x-hamon-collection'

/** dragover の時点では中身を読めないので、types だけで判定する */
export function isTrackDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes(TRACK_MIME)
}

export function isCollectionDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes(COLLECTION_MIME)
}

export function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

export function setTrackDragData(event, trackId) {
  event.dataTransfer.setData(TRACK_MIME, trackId)
  event.dataTransfer.effectAllowed = 'copyMove'
}

export function getTrackDragData(event) {
  return event.dataTransfer.getData(TRACK_MIME) || null
}

/**
 * コレクションのドラッグ。複数選択したままでも掴めるよう、
 * 中身は常に id の配列（改行区切り）として持つ。
 */
export function setCollectionDragData(event, collectionIds) {
  const ids = Array.isArray(collectionIds) ? collectionIds : [collectionIds]
  event.dataTransfer.setData(COLLECTION_MIME, ids.join('\n'))
  event.dataTransfer.effectAllowed = 'copy'
}

/** @returns {string[]} */
export function getCollectionDragData(event) {
  const raw = event.dataTransfer.getData(COLLECTION_MIME)
  return raw ? raw.split('\n').filter(Boolean) : []
}

/**
 * ドラッグ中にマウスへ追随する小さなサムネイルを付ける。
 *
 * setDragImage は「その瞬間に画面に出ている要素」しか写し取れないので、
 * 画面外ではなく画面内の見えない位置に置いてから渡し、次のフレームで片付ける。
 *
 * @param {DragEvent} event
 * @param {{coverUrl?: string|null, label: string}} options
 */
export function attachDragThumbnail(event, { coverUrl, label }) {
  const ghost = document.createElement('div')
  ghost.className = 'draghost'

  if (coverUrl) {
    const image = document.createElement('img')
    image.className = 'draghost__art'
    image.src = coverUrl
    image.alt = ''
    ghost.append(image)
  } else {
    const fallback = document.createElement('span')
    fallback.className = 'draghost__art draghost__art--empty'
    fallback.textContent = '♪'
    ghost.append(fallback)
  }

  const text = document.createElement('span')
  text.className = 'draghost__label'
  text.textContent = label
  ghost.append(text)

  document.body.append(ghost)
  // カーソルの少し右下に出す
  event.dataTransfer.setDragImage(ghost, -12, -12)
  requestAnimationFrame(() => ghost.remove())
}

/**
 * ドロップされた File[] を実ファイルのパスへ変換する。
 * Electron 32 で File.path が廃止されたので preload 経由で解決する。
 */
export function filePathsFrom(dataTransfer) {
  return Array.from(dataTransfer?.files ?? [])
    .map((file) => window.hamon.pathForFile(file))
    .filter(Boolean)
}

export function splitByExtension(paths, extensions) {
  const matched = []
  const rest = []
  for (const path of paths) {
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    ;(extensions.includes(extension) ? matched : rest).push(path)
  }
  return [matched, rest]
}
