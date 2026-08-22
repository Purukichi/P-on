/** アプリ内でトラックをドラッグするときの MIME 型 */
export const TRACK_MIME = 'application/x-hamon-track'
/** コレクション（アルバム / シングル / プレイリスト）をドラッグするときの MIME 型 */
export const COLLECTION_MIME = 'application/x-hamon-collection'
/** 一覧の中での並び替え。曲の持ち出し（TRACK_MIME）とは行き先が違うので型を分けている */
export const REORDER_MIME = 'application/x-hamon-reorder'

/** dragover の時点では中身を読めないので、types だけで判定する */
export function isTrackDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes(TRACK_MIME)
}

export function isCollectionDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes(COLLECTION_MIME)
}

export function isReorderDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes(REORDER_MIME)
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

export function setReorderDragData(event, trackId) {
  event.dataTransfer.setData(REORDER_MIME, trackId)
  event.dataTransfer.effectAllowed = 'move'
}

export function getReorderDragData(event) {
  return event.dataTransfer.getData(REORDER_MIME) || null
}

/**
 * コレクションのドラッグ。複数選択したままでも掴めるよう、
 * 中身は常に id の配列（改行区切り）として持つ。
 */
export function setCollectionDragData(event, collectionIds) {
  const ids = Array.isArray(collectionIds) ? collectionIds : [collectionIds]
  event.dataTransfer.setData(COLLECTION_MIME, ids.join('\n'))
  /*
   * 行き先によって copy（プレイリストへ追加）と move（ゴミ箱）に分かれる。
   * 'copy' だけを許すと、move を求めるゴミ箱では drop 自体が成立しない。
   */
  event.dataTransfer.effectAllowed = 'copyMove'
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
 * ブラウザが描く半透明のドラッグ画像を消す。
 *
 * setDragImage に渡せるのは「その瞬間に描画されている要素」だけなので、
 * 画面外ではなく見えない場所（左に -9999px）へ 1px の板を一瞬だけ置く。
 *
 * 曲順の並べ替えでは、指について来る短冊を自前で描いて動かしている。
 * ブラウザ任せの絵は薄く透かされてしまい、濃さを指定できないため。
 */
export function hideNativeDragImage(event) {
  const blank = document.createElement('div')
  blank.className = 'dragblank'
  document.body.append(blank)
  event.dataTransfer.setDragImage(blank, 0, 0)
  requestAnimationFrame(() => blank.remove())
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
