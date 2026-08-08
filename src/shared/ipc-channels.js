/**
 * main / preload の両方から読まれる定数。
 * ここには electron に依存するコードを書かないこと。
 */
export const IPC = {
  /** ファイル選択ダイアログを開き、選ばれた音声ファイルの参照を返す */
  OPEN_AUDIO_FILE: 'library:open-audio-file',
  /** 既知のファイルパスから再生用 URL を作り直す (プレイリスト復元などで使う) */
  RESOLVE_AUDIO_FILE: 'library:resolve-audio-file'
}

/** 再生対象として扱う拡張子 (Chromium が標準でデコードできるもの) */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'webm']
