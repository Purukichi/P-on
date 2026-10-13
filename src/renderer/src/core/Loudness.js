import { Emitter } from './Emitter.js'
import { LoudnessMeter } from './loudness-meter.js'

/**
 * ラウドネスノーマライズ（曲ごとの音量差をならす再生）。
 *
 * どちらも ITU-R BS.1770 の積分ラウドネスで曲を測り、目標との差だけ音量を上げ下げする。
 *
 * Spotify（既定の「標準」設定）
 *   - 目標 -14 LUFS（Spotify for Artists「Loudness normalization」）
 *   - 小さい曲を持ち上げるときはトゥルーピークを見て上げ幅を抑え、
 *     非可逆圧縮の音源では 1 dB の余白を残す（= -1 dBTP まで）。可逆の音源は 0 dBTP まで
 *   - リミッターを掛けるのは「大」設定だけなので、ここでは掛けない
 *
 * Apple Music（サウンドチェック）
 *   - 目標 -16 LUFS。Apple は数値を公式に文書化していないが、
 *     2022 年に LUFS 基準へ切り替わって以降の実測値として広く使われている値
 *   - 持ち上げる場合の上限も公表されていないので、Apple が配信用マスターに求める
 *     -1 dBTP を超えない範囲に留める（クリップさせない）
 *
 * 曲は 1 曲ずつ測る（Spotify がアルバム再生時に行うアルバム単位の調整はしていない）。
 */

export const LoudnessMode = {
  OFF: 'off',
  SPOTIFY: 'spotify',
  APPLE: 'apple'
}

/** 押すたびにこの順で巡る */
const MODE_ORDER = [LoudnessMode.OFF, LoudnessMode.SPOTIFY, LoudnessMode.APPLE]

export const LOUDNESS_PROFILES = {
  [LoudnessMode.SPOTIFY]: {
    label: 'Spotify',
    /** 幅が足りないとき（スマホ）に出す名前 */
    shortLabel: 'Spotify',
    /** LUFS */
    target: -14,
    /** 持ち上げるときのトゥルーピークの上限（dBTP） */
    ceiling: { lossy: -1, lossless: 0 }
  },
  [LoudnessMode.APPLE]: {
    label: 'Apple Music',
    shortLabel: 'Apple',
    target: -16,
    ceiling: { lossy: -1, lossless: -1 }
  }
}

/**
 * 目標に合わせるための増減（dB）。
 * 下げるぶんには制限なし。上げるときだけ、トゥルーピークが上限を越えない所で止める。
 *
 * @param {{integrated: number, truePeak: number}|null} measurement
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

const MODE_KEY = 'hamon.loudness'
const CACHE_KEY = 'hamon.loudness-cache'
/** 測り方を変えたら上げる。古い測定値は読まずに測り直す */
const CACHE_VERSION = 1
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
 * 測った値は端末に残すので、同じ曲は 2 回目から即座に揃う。
 *
 * events: 'change' (status) — モードや測定状況が変わったとき
 */
export class LoudnessNormalizer extends Emitter {
  #engine
  #storage
  #mode
  /** @type {Record<string, {integrated: number|null, truePeak: number|null}>} */
  #cache
  /** 測れなかった曲（形式が読めない / 長すぎる）。起動し直すまでは測り直さない */
  #skipped = new Map()
  /** @type {import('./Track.js').Track|null} */
  #track = null
  /** @type {import('./Track.js').Track[]} 次に鳴りそうな曲（先に測っておく） */
  #upcoming = []
  /** いま測っている曲のキー */
  #running = null

  constructor(engine, { storage = globalThis.localStorage } = {}) {
    super()
    this.#engine = engine
    this.#storage = storage
    const saved = safeGet(storage, MODE_KEY)
    this.#mode = MODE_ORDER.includes(saved) ? saved : LoudnessMode.OFF
    this.#cache = loadCache(storage)
  }

  get mode() {
    return this.#mode
  }

  /** 次のモードへ切り替える */
  cycle() {
    const next = MODE_ORDER[(MODE_ORDER.indexOf(this.#mode) + 1) % MODE_ORDER.length]
    this.#mode = next
    safeSet(this.#storage, MODE_KEY, next)
    this.#apply({ smooth: true })
    this.#schedule()
    this.#emitChange()
    return next
  }

  /** 鳴らす曲が変わったら呼ぶ */
  setTrack(track) {
    this.#track = track
    this.#apply({ smooth: false })
    this.#schedule()
    this.#emitChange()
  }

  /** これから鳴りそうな曲を渡しておくと、手が空いているときに測っておく */
  prefetch(tracks) {
    this.#upcoming = tracks.filter(Boolean)
    this.#schedule()
  }

  /**
   * 画面に出すための現在の状態。
   * state: 'off' | 'idle'（曲なし）| 'pending'（測定中）| 'ready' | 'skipped'
   */
  get status() {
    const mode = this.#mode
    const profile = LOUDNESS_PROFILES[mode] ?? null
    const track = this.#track
    if (!profile) return { mode, profile, state: 'off' }
    if (!track) return { mode, profile, state: 'idle' }

    const key = trackKey(track)
    const skipped = this.#skipped.get(key)
    if (skipped) return { mode, profile, state: 'skipped', reason: skipped }

    const measurement = this.#cache[key]
    if (!measurement) return { mode, profile, state: 'pending' }
    return {
      mode,
      profile,
      state: 'ready',
      measurement,
      gainDb: normalizationGainDb(measurement, profile, { lossless: isLossless(track) })
    }
  }

  // ---- 内部 --------------------------------------------------------------

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

  /** 測っていない曲を 1 曲ずつ測る。鳴っている曲を最優先にする */
  async #schedule() {
    if (this.#running || this.#mode === LoudnessMode.OFF) return

    const target = [this.#track, ...this.#upcoming].find((track) => {
      if (!track?.audioUrl) return false
      const key = trackKey(track)
      return !this.#cache[key] && !this.#skipped.has(key)
    })
    if (!target) return

    const key = trackKey(target)
    this.#running = key
    try {
      if (Number.isFinite(target.duration) && target.duration > MAX_ANALYSIS_SECONDS) {
        this.#skipped.set(key, 'too-long')
      } else {
        const measurement = await analyzeTrack(target)
        this.#cache[key] = measurement
        saveCache(this.#storage, this.#cache)
      }
    } catch (error) {
      console.warn('[loudness] 測定できませんでした:', target.displayTitle, error)
      this.#skipped.set(key, 'unreadable')
    } finally {
      this.#running = null
    }

    if (this.#track && trackKey(this.#track) === key) {
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
 * @returns {Promise<{integrated: number|null, truePeak: number|null}>}
 */
export async function analyzeTrack(track) {
  const response = await fetch(track.audioUrl)
  if (!response.ok) throw new Error(`読み込めませんでした (${response.status})`)
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
  const { integrated, truePeak } = result
  // JSON に -Infinity は書けないので、測れなかった値は null で持つ
  return {
    integrated: Number.isFinite(integrated) ? round2(integrated) : null,
    truePeak: Number.isFinite(truePeak) ? round2(truePeak) : null
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

// ---- 保存 ----------------------------------------------------------------

function loadCache(storage) {
  try {
    const parsed = JSON.parse(safeGet(storage, CACHE_KEY) ?? 'null')
    if (parsed?.version === CACHE_VERSION && parsed.tracks) return parsed.tracks
  } catch {
    // 壊れていたら測り直す
  }
  return {}
}

function saveCache(storage, tracks) {
  safeSet(storage, CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, tracks }))
}

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
    // 容量切れなど。測り直せば済むので黙って諦める
  }
}
