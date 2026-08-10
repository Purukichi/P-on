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
  /** アルバムのアーティスト。収録曲ごとの artist とは別に持つ */
  LIBRARY_SET_ALBUM_ARTIST: 'library:set-album-artist',
  /** アルバム名の変更。ジャケットとアルバムのアーティストも一緒に付け替える */
  LIBRARY_RENAME_ALBUM: 'library:rename-album',
  /** 複数の曲にまとめてアルバム名を書き込む（シングルをアルバムにまとめ直す） */
  LIBRARY_SET_ALBUM: 'library:set-album',
  /** 複数の曲にまとめてアーティストを書き込む（収録曲側の一括変更） */
  LIBRARY_SET_ARTIST: 'library:set-artist',
  LIBRARY_DELETE_TRACK: 'library:delete-track',
  LIBRARY_OPEN_FOLDER: 'library:open-folder',
  /** 保存先のフォルダとデータの移し方を選ばせる（ダイアログは main 側で出す） */
  LIBRARY_CHOOSE_LOCATION: 'library:choose-location',
  /** 選ばれた保存先へ実際に切り替える */
  LIBRARY_APPLY_LOCATION: 'library:apply-location',
  /** format を持っていない既存レコードにフォーマット情報を埋める */
  LIBRARY_BACKFILL_FORMATS: 'library:backfill-formats',

  // プレイリスト
  PLAYLIST_CREATE: 'playlist:create',
  PLAYLIST_RENAME: 'playlist:rename',
  PLAYLIST_DELETE: 'playlist:delete',
  PLAYLIST_ADD_TRACKS: 'playlist:add-tracks',
  PLAYLIST_REMOVE_TRACK: 'playlist:remove-track',
  /** プレイリストのジャケット。id に紐づくので改名しても外れない */
  PLAYLIST_SET_COVER: 'playlist:set-cover',
  PLAYLIST_PICK_COVER: 'playlist:pick-cover',

  // 確認ダイアログ
  CONFIRM: 'app:confirm',

  /** バージョンと、この環境で自動更新が使えるか */
  APP_INFO: 'app:info',
  /** 手動での更新確認 */
  APP_CHECK_UPDATE: 'app:check-update',

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
  /** ミニプレイヤーの形（縦長 / 正方形 / 横長） */
  WINDOW_MINI_SHAPE: 'window:mini-shape',
  /** ミニプレイヤーを常に手前に出すか */
  WINDOW_MINI_ON_TOP: 'window:mini-on-top',
  /** テーマ変更時に、OS が描くタイトルバーの色を本文と揃える */
  WINDOW_SET_TITLEBAR: 'window:set-titlebar'
}

/** 再生対象として扱う拡張子 (Chromium が標準でデコードできるもの) */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'webm']

/** ジャケットとして受け付ける拡張子 */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']
