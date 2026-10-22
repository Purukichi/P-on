import { Emitter } from './Emitter.js'
import { LoudnessMeter, combineLoudness } from './loudness-meter.js'
import { openLoudnessStore } from './loudness-store.js'

/**
 * ラウドネスノーマライズ（曲ごとの音量差をならす再生）。Spotify の「標準」設定に合わせている。
 *
 * - 曲は ITU-R BS.1770 の積分ラウドネスで測り、-14 LUFS との差だけ音量を上げ下げする
 *   （Spotify for Artists「Loudness normalization」）
 * - 小さい曲を持ち上げるときはトゥルーピークを見て上げ幅を抑え、
 *   非可逆圧縮の音源では 1 dB の余白を残す（= -1 dBTP まで）。可逆の音源は 0 dBTP まで
 * - リミッターを掛けるのは Spotify でも「大」設定だけなので、ここでは掛けない
 * - アルバムを曲順どおりに通して聴くときは、アルバム全体を 1 本として測った値で揃え、
 *   アルバムの中では音量を動かさない（静かな曲は静かなまま）。
 *   シャッフルやプレイリスト、寄せ集めのキューでは 1 曲ずつ揃える。これも Spotify と同じ
 *
 * 測るのは再生のときではなく、取り込んだ時点から。ライブラリの曲を裏で 1 曲ずつ測っておき、
 * 結果は一覧の各曲の「i」にも出す。
 */

export const LoudnessMode = {
  OFF: 'off',
  SPOTIFY: 'spotify'
}

export const SPOTIFY_PROFILE = {
  label: 'Spotify',
  /** LUFS */
  target: -14,
  /** 持ち上げるときのトゥルーピークの上限（dBTP） */
  ceiling: { lossy: -1, lossless: 0 }
}

/**
 * 目標に合わせるための増減（dB）。
 * 下げるぶんには制限なし。上げるときだけ、トゥルーピークが上限を越えない所で止める。
 *
 * @param {{integrated: number|null, truePeak: number|null}|null} measurement
 * @param {{target: number, ceiling: {lossy: number, lossless: number}}} profile
 * @param {{lossless?: boolean}} [options]
 */
export function normalizationGainDb(measurement, profile, { lossless = false } = {}) {
  if (!measurement || !Number.isFinite(measurement.integrated)) return 0
  const gain = profile.target - measurement.integrated
  if (gain <= 0) return gain

  const ceiling = lossless ? profile.ceiling.lossless : profile.ceiling.lossy
  const headroom = Number.isFinite(measurement.truePeak) ? ceiling - measurement.truePeak : gain
  return Math.max(0, Math.min(gain, headroom))
}

/**
 * 何曲かをまとめて 1 本とみなした測定値（アルバム単位の補正に使う）。
 * ラウドネスは各曲のブロックの分布を足し合わせてゲートをかけ直したもの、
 * トゥルーピークは全曲のうちいちばん高いもの。
 *
 * @param {{truePeak: number|null, histogram: import('./loudness-meter.js').Histogram}[]} measurements
 */
export function combineMeasurements(measurements) {
  const integrated = combineLoudness(measurements.map((m) => m.histogram))
  const peaks = measurements.map((m) => m.truePeak).filter(Number.isFinite)
  return {
    integrated: Number.isFinite(integrated) ? round2(integrated) : null,
    truePeak: peaks.length > 0 ? Math.max(...peaks) : null
  }
}

const MODE_KEY = 'hamon.loudness'
/** 1.4.0 で使っていた localStorage の測定結果。分布を持っていないので捨てて測り直す */
const LEGACY_CACHE_KEY = 'hamon.loudness-cache'
/** 測り方や残す中身を変えたら上げる。古い測定値は読まずに測り直す */
const RECORD_VERSION = 3
/**
 * これより長い曲は測らない（そのままの音量で鳴らす）。
 * 測るときは曲全体を一度ほどくので、48 kHz ステレオで 20 分 ≒ 460 MB を抱えることになる。
 */
const MAX_ANALYSIS_SECONDS = 20 * 60
/** BS.1770 のトゥルーピークの係数は 48 kHz 用なので、測る前にこのレートへ揃える */
const ANALYSIS_SAMPLE_RATE = 48000
/** Worker へ一度に渡す長さ */
const CHUNK_SECONDS = 10

/**
 * 曲の測定と、AudioEngine へのゲインの受け渡しを受け持つ。
 *
 * events:
 *   'change'   (status) — オン / オフや、鳴っている曲の補正が変わったとき
 *   'measured' (track|null) — どれかの曲を測り終えたとき（一覧の表示を更新する）
 */
export class LoudnessNormalizer extends Emitter {
  #engine
  #storage
  #mode
  /** IndexedDB に残した測定結果。開き終わるまでは null @type {Awaited<ReturnType<typeof openLoudnessStore>>|null} */
  #store = null
  /** 測れなかった曲（形式が読めない / 長すぎる）。起動し直すまでは測り直さない */
  #skipped = new Map()
  /** @type {import('./Track.js').Track|null} */
  #track = null
  /**
   * アルバム単位で揃える範囲。アルバムを曲順どおりに鳴らしている間だけ入る。
   * @type {{id: string, name: string, tracks: import('./Track.js').Track[]}|null}
   */
  #album = null
  /** @type {import('./Track.js').Track[]} 次に鳴りそうな曲（先に測っておく） */
  #upcoming = []
  /** @type {import('./Track.js').Track[]} ライブラリの全曲。手が空いたら新しく取り込んだ順に測る */
  #library = []
  /** いま測っている曲のキー */
  #running = null

  constructor(engine, { storage = globalThis.localStorage, openStore = openLoudnessStore } = {}) {
    super()
    this.#engine = engine
    this.#storage = storage
    // 1.4.0 の Apple Music 準拠は無くしたので、選んでいた人も Spotify 準拠でオンのままにする
    const saved = safeGet(storage, MODE_KEY)
    this.#mode = saved && saved !== LoudnessMode.OFF ? LoudnessMode.SPOTIFY : LoudnessMode.OFF
    safeRemove(storage, LEGACY_CACHE_KEY)

    openStore().then((store) => {
      this.#store = store
      this.#prune()
      this.#apply({ smooth: true })
      this.#emitChange()
      this.emit('measured', null)
      this.#schedule()
    })
  }

  get mode() {
    return this.#mode
  }

  /** オン / オフを切り替える */
  toggle() {
    this.#mode = this.#mode === LoudnessMode.OFF ? LoudnessMode.SPOTIFY : LoudnessMode.OFF
    safeSet(this.#storage, MODE_KEY, this.#mode)
    this.#apply({ smooth: true })
    this.#emitChange()
    return this.#mode
  }

  /** 鳴らす曲が変わったら呼ぶ（再生が始まる前に） */
  setTrack(track) {
    this.#track = track
    this.#apply({ smooth: false })
    this.#schedule()
    this.#emitChange()
  }

  /**
   * アルバム単位で揃える範囲を決める。アルバムを曲順どおりに鳴らしているときだけ渡し、
   * シャッフル / プレイリスト / 寄せ集めのキューでは null（1 曲ずつ揃える）。
   * @param {{id: string, name: string, tracks: import('./Track.js').Track[]}|null} album
   */
  setAlbum(album) {
    const signature = (value) => (value ? `${value.id}:${value.tracks.map(trackKey).join(',')}` : '')
    if (signature(album) === signature(this.#album)) return
    this.#album = album
    this.#apply({ smooth: true })
    this.#schedule()
    this.#emitChange()
  }

  /** これから鳴りそうな曲を渡しておくと、先に測っておく */
  prefetch(tracks) {
    this.#upcoming = tracks.filter(Boolean)
    this.#schedule()
  }

  /** ライブラリの全曲を渡しておくと、まだ測っていない曲を新しく取り込んだものから測る */
  setLibrary(tracks) {
    this.#library = [...tracks].sort((a, b) =>
      String(b.addedAt ?? '').localeCompare(String(a.addedAt ?? ''))
    )
    this.#prune()
    this.#schedule()
  }

  /**
   * 一覧に出すための、曲ごとの測定状況。
   * @returns {{state: 'ready', measurement: {integrated: number|null, truePeak: number|null}}
   *   | {state: 'pending'} | {state: 'skipped', reason: 'too-long'|'unreadable'}}
   */
  infoOf(track) {
    const skipped = this.#skipped.get(trackKey(track))
    if (skipped) return { state: 'skipped', reason: skipped }
    const measurement = this.#measurement(track)
    return measurement ? { state: 'ready', measurement } : { state: 'pending' }
  }

  /**
   * ボタンに出すための、鳴っている曲の状態。
   * state: 'off' | 'idle'（曲なし）| 'pending'（測定中）| 'ready' | 'skipped'
   * basis: 'album'（アルバム全体の値で揃えている）| 'track'
   */
  get status() {
    const mode = this.#mode
    const profile = SPOTIFY_PROFILE
    const track = this.#track
    if (mode === LoudnessMode.OFF) return { mode, profile, state: 'off' }
    if (!track) return { mode, profile, state: 'idle' }

    const album = this.#albumMeasurement()
    if (album) {
      return {
        mode,
        profile,
        state: 'ready',
        basis: 'album',
        albumName: this.#album.name,
        measurement: album.measurement,
        gainDb: normalizationGainDb(album.measurement, profile, { lossless: album.lossless })
      }
    }

    const info = this.infoOf(track)
    if (info.state !== 'ready') return { mode, profile, ...info }
    return {
      mode,
      profile,
      state: 'ready',
      basis: 'track',
      measurement: info.measurement,
      gainDb: normalizationGainDb(info.measurement, profile, { lossless: isLossless(track) })
    }
  }

  // ---- 内部 --------------------------------------------------------------

  #measurement(track) {
    const record = this.#store?.entries.get(trackKey(track))
    return record?.version === RECORD_VERSION ? record : null
  }

  /**
   * アルバム全体の測定値。アルバム単位で揃える場面で、全曲を測り終えているときだけ返す
   * （途中までの値で揃えると、測り終えた時点で音量がずれるため。それまでは 1 曲ずつ揃える）。
   * 長すぎる / 読めない曲は数に入れない。
   */
  #albumMeasurement() {
    const album = this.#album
    const track = this.#track
    if (!album || !track || !album.tracks.some((t) => t.id === track.id)) return null

    const measured = []
    for (const albumTrack of album.tracks) {
      if (this.#skipped.has(trackKey(albumTrack))) continue
      const measurement = this.#measurement(albumTrack)
      if (!measurement) return null
      measured.push({ track: albumTrack, measurement })
    }
    if (measured.length === 0) return null

    return {
      measurement: combineMeasurements(measured.map((m) => m.measurement)),
      // 1 曲でも非可逆が混ざっていれば、余白は非可逆の側に合わせる
      lossless: measured.every((m) => isLossless(m.track))
    }
  }

  #apply({ smooth }) {
    const status = this.status
    switch (status.state) {
      case 'off':
        this.#engine.setNormalizationGain(null, { smooth })
        break
      case 'ready':
        this.#engine.setNormalizationGain(status.gainDb, { smooth })
        break
      case 'skipped':
        this.#engine.setNormalizationGain(0, { smooth })
        break
      case 'pending': {
        // 測り終わるまでは、前の曲で上げていたぶんだけ戻しておく（大きく鳴りすぎないように）
        const current = this.#engine.normalizationGain ?? 0
        this.#engine.setNormalizationGain(Math.min(current, 0), { smooth })
        break
      }
    }
  }

  /** ライブラリから消えた曲（音源を差し替えた曲の古い音を含む）の測定結果を捨てる */
  #prune() {
    if (!this.#store || this.#library.length === 0) return
    const keys = new Set(this.#library.map(trackKey))
    for (const key of [...this.#store.entries.keys()]) {
      if (!keys.has(key)) this.#store.remove(key)
    }
  }

  /**
   * 測っていない曲を 1 曲ずつ測る。オフの間も測っておく（一覧の「i」に出すため）。
   * 鳴っている曲 → 鳴らしているアルバムの残り → 次に鳴る曲 → ライブラリ（新しい順）の順に拾う。
   */
  async #schedule() {
    if (this.#running || !this.#store) return

    const candidates = [
      this.#track,
      ...(this.#album?.tracks ?? []),
      ...this.#upcoming,
      ...this.#library
    ]
    const target = candidates.find(
      (track) => track?.audioUrl && !this.#measurement(track) && !this.#skipped.has(trackKey(track))
    )
    if (!target) return

    const key = trackKey(target)
    this.#running = key
    try {
      if (Number.isFinite(target.duration) && target.duration > MAX_ANALYSIS_SECONDS) {
        this.#skipped.set(key, 'too-long')
      } else {
        const measurement = await analyzeTrack(target)
        this.#store.put(key, { version: RECORD_VERSION, ...measurement })
      }
    } catch (error) {
      console.warn('[loudness] 測定できませんでした:', target.displayTitle, error)
      this.#skipped.set(key, 'unreadable')
    } finally {
      this.#running = null
    }

    this.emit('measured', target)
    // 鳴っている曲か、鳴らしているアルバムの曲なら、補正が変わりうる
    const affectsPlayback =
      (this.#track && trackKey(this.#track) === key) ||
      this.#album?.tracks.some((track) => trackKey(track) === key)
    if (affectsPlayback) {
      this.#apply({ smooth: true })
      this.#emitChange()
    }
    this.#schedule()
  }

  #emitChange() {
    this.emit('change', this.status)
  }
}

/**
 * 同じ曲でも音源を差し替えるとファイル名が変わるので、id とファイル名の組で覚えておく。
 * @param {import('./Track.js').Track} track
 */
function trackKey(track) {
  return `${track.id}|${track.audioFile ?? track.audioUrl}`
}

function isLossless(track) {
  return track.format?.lossless === true
}

// ---- 測定 ----------------------------------------------------------------

/** Worker は 1 本だけ使い回す（測定は LoudnessNormalizer が 1 曲ずつ流す）。作れなければ false */
let worker = null

function getWorker() {
  if (worker === null) {
    try {
      worker = new Worker(new URL('./loudness.worker.js', import.meta.url), { type: 'module' })
    } catch (error) {
      console.warn('[loudness] Worker を作れないので画面側で測ります:', error)
      worker = false
    }
  }
  return worker
}

/**
 * 音源を読み込んで BS.1770 で測る。
 * @returns {Promise<{integrated: number|null, truePeak: number|null, histogram: import('./loudness-meter.js').Histogram}>}
 */
export async function analyzeTrack(track) {
  const response = await fetch(track.audioUrl)
  if (!response.ok) throw new Error(`Couldn’t load (${response.status})`)
  const encoded = await response.arrayBuffer()

  // decodeAudioData は文脈のサンプルレートへ変換してからほどいてくれる
  const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE)
  const buffer = await context.decodeAudioData(encoded)

  const target = getWorker()
  let result
  try {
    result = target ? await measureInWorker(target, buffer) : await measureInline(buffer)
  } catch (error) {
    // Worker が読み込めない環境（file:// の制限など）では、以後は画面側で測る
    console.warn('[loudness] Worker で測れなかったので画面側で測ります:', error)
    target?.terminate()
    worker = false
    result = await measureInline(buffer)
  }
  const { integrated, truePeak, histogram } = result
  // 保存先に -Infinity を持ち込まないよう、測れなかった値は null で持つ
  return {
    integrated: Number.isFinite(integrated) ? round2(integrated) : null,
    truePeak: Number.isFinite(truePeak) ? round2(truePeak) : null,
    histogram
  }
}

/** AudioBuffer を頭から CHUNK_SECONDS ずつ切り出す */
function* chunksOf(buffer) {
  const chunkLength = Math.round(buffer.sampleRate * CHUNK_SECONDS)
  for (let offset = 0; offset < buffer.length; offset += chunkLength) {
    const length = Math.min(chunkLength, buffer.length - offset)
    const channels = []
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = new Float32Array(length)
      buffer.copyFromChannel(data, channel, offset)
      channels.push(data)
    }
    yield channels
  }
}

/** Worker が使えないときの代わり。区切りごとに手を離して、画面が固まり続けないようにする */
async function measureInline(buffer) {
  const meter = new LoudnessMeter({
    sampleRate: buffer.sampleRate,
    channelCount: buffer.numberOfChannels
  })
  for (const channels of chunksOf(buffer)) {
    meter.push(channels)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return meter.result
}

function measureInWorker(target, buffer) {
  const chunks = chunksOf(buffer)

  return new Promise((resolve, reject) => {
    const sendNext = () => {
      const { value: channels, done } = chunks.next()
      if (done) {
        target.postMessage({ type: 'finish' })
        return
      }
      target.postMessage(
        { type: 'chunk', channels },
        channels.map((data) => data.buffer)
      )
    }

    const onMessage = ({ data }) => {
      if (data.type === 'ack') {
        sendNext()
      } else if (data.type === 'result') {
        cleanup()
        resolve(data)
      }
    }
    const onError = (event) => {
      cleanup()
      reject(event.error ?? new Error(event.message ?? 'worker error'))
    }
    const cleanup = () => {
      target.removeEventListener('message', onMessage)
      target.removeEventListener('error', onError)
    }

    target.addEventListener('message', onMessage)
    target.addEventListener('error', onError)
    target.postMessage({
      type: 'start',
      sampleRate: buffer.sampleRate,
      channelCount: buffer.numberOfChannels
    })
  })
}

function round2(value) {
  return Math.round(value * 100) / 100
}

// ---- 設定の保存 ----------------------------------------------------------

function safeGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem(key, value)
  } catch {
    // 保存できなくても、起動している間は効いている
  }
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem(key)
  } catch {
    // 消せなくても害はない
  }
}
