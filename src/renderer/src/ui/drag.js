/** アプリ内でトラックをドラッグするときの MIME 型 */
export const TRACK_MIME = 'application/x-hamon-track'

/** dragover の時点では中身を読めないので、types だけで判定する */
export function isTrackDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes(TRACK_MIME)
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
