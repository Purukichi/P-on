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
  LIBRARY_SET_ALBUM_COVER: 'library:set-album-cover',
  LIBRARY_PICK_ALBUM_COVER: 'library:pick-album-cover',
  /** 複数の曲にまとめてアルバム名を書き込む（シングルをアルバムにまとめ直す） */
  LIBRARY_SET_ALBUM: 'library:set-album',
  LIBRARY_DELETE_TRACK: 'library:delete-track',
  LIBRARY_OPEN_FOLDER: 'library:open-folder',
  /** format を持っていない既存レコードにフォーマット情報を埋める */
  LIBRARY_BACKFILL_FORMATS: 'library:backfill-formats',

  // プレイリスト
  PLAYLIST_CREATE: 'playlist:create',
  PLAYLIST_RENAME: 'playlist:rename',
  PLAYLIST_DELETE: 'playlist:delete',
  PLAYLIST_ADD_TRACKS: 'playlist:add-tracks',
  PLAYLIST_REMOVE_TRACK: 'playlist:remove-track',

  // 確認ダイアログ
  CONFIRM: 'app:confirm',

  /*
   * ミニプレイヤー。
   * 音を出しているのは常にメインウィンドウ側の <audio> ひとつだけで、
   * ミニウィンドウは表示と操作だけを担当するリモコン。
   * main プロセスは両者の間を中継するだけなので、
   * ウィンドウを切り替えても再生が途切れない。
   */
  PLAYER_STATE: 'player:state', // メインウィンドウ -> main -> ミニ
  PLAYER_COMMAND: 'player:command', // ミニ -> main -> メインウィンドウ
  PLAYER_REQUEST_STATE: 'player:request-state', // ミニ -> main -> メインウィンドウ

  // ウィンドウの切り替え
  WINDOW_OPEN_MINI: 'window:open-mini',
  WINDOW_CLOSE_MINI: 'window:close-mini',
  /** ミニプレイヤーからアプリごと終了する */
  WINDOW_QUIT: 'window:quit',
  /** テーマ変更時に、OS が描くタイトルバーの色を本文と揃える */
  WINDOW_SET_TITLEBAR: 'window:set-titlebar'
}

/** 再生対象として扱う拡張子 (Chromium が標準でデコードできるもの) */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'webm']

/** ジャケットとして受け付ける拡張子 */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']
