/**
 * main / preload の両方から読まれる定数。
 * ここには electron に依存するコードを書かないこと。
 */
export const IPC = {
  // ライブラリ
  LIBRARY_SNAPSHOT: 'library:snapshot',
  LIBRARY_IMPORT: 'library:import',
  LIBRARY_PICK_FILES: 'library:pick-files',
  LIBRARY_UPDATE_TRACK: 'library:update-track',
  LIBRARY_SET_COVER: 'library:set-cover',
  LIBRARY_PICK_COVER: 'library:pick-cover',
  LIBRARY_DELETE_TRACK: 'library:delete-track',
  LIBRARY_OPEN_FOLDER: 'library:open-folder',

  // プレイリスト
  PLAYLIST_CREATE: 'playlist:create',
  PLAYLIST_RENAME: 'playlist:rename',
  PLAYLIST_DELETE: 'playlist:delete',
  PLAYLIST_ADD_TRACKS: 'playlist:add-tracks',
  PLAYLIST_REMOVE_TRACK: 'playlist:remove-track',

  // 確認ダイアログ
  CONFIRM: 'app:confirm'
}

/** 再生対象として扱う拡張子 (Chromium が標準でデコードできるもの) */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'webm']

/** ジャケットとして受け付ける拡張子 */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']
