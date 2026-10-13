/**
 * ITU-R BS.1770-4 のラウドネス（積分ラウドネス / LUFS）とトゥルーピーク（dBTP）を測る。
 *
 * Spotify も Apple Music も、曲の大きさはこの規格で測った積分ラウドネスで揃えている。
 * 同じ物差しで測らないと「準拠」にならないので、規格の手順をそのまま追っている。
 *
 * - K 特性フィルタ（高域シェルフ + 低域カット）を通した二乗平均を、
 *   400 ms のブロック（75% ずつ重ねる = 100 ms 刻み）ごとに求める
 * - -70 LUFS 未満のブロックを捨て（絶対ゲート）、残りの平均より 10 LU 低いブロックも捨てる（相対ゲート）
 * - 残ったブロックの平均が積分ラウドネス
 * - トゥルーピークは Annex 2 の 4 倍オーバーサンプリング（48 kHz 前提）で、サンプル間の山を拾う
 *
 * 音はまとめて渡さず push() で少しずつ流し込める。長い曲でも複製を抱え込まずに済むように。
 */

const SEGMENT_SECONDS = 0.1
/** 400 ms のブロック = 100 ms の区間 4 つ */
const SEGMENTS_PER_BLOCK = 4
const ABSOLUTE_GATE_LUFS = -70
const RELATIVE_GATE_LU = -10

/**
 * Annex 2 のオーバーサンプリング用 FIR（48 タップを 4 位相に分けたもの）。
 * 48 kHz の入力を 192 kHz 相当で見るための係数なので、入力は 48 kHz にしてから渡すこと。
 */
const TRUE_PEAK_PHASES = [
  [
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875,
    0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125,
    0.014892578125, -0.00830078125
  ],
  [
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625,
    0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625,
    0.0330810546875, -0.0189208984375
  ],
  [
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125,
    0.77978515625, 0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125,
    0.029296875, -0.0291748046875
  ],
  [
    -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875,
    0.97216796875, 0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125,
    0.010986328125, 0.001708984375
  ]
]
const TAPS = TRUE_PEAK_PHASES[0].length
/** 位相ごとの係数を時間を逆順にして平らに並べたもの（内側のループで添字を足していくだけで済む） */
const TRUE_PEAK_KERNEL = Float64Array.from(
  TRUE_PEAK_PHASES.flatMap((phase) => [...phase].reverse())
)

/** 二乗平均（パワー）を LUFS に直す。規格の式そのまま */
export function powerToLufs(power) {
  return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity
}

/**
 * K 特性フィルタの係数。
 * 規格には 48 kHz の値しか載っていないので、libebur128 と同じ設計式から任意のサンプルレートで作る
 * （48 kHz では規格の表の値と一致する）。
 */
export function kWeightingCoefficients(sampleRate) {
  // 1 段目: 頭の影響を模した高域シェルフ（+4 dB）
  let f0 = 1681.974450955533
  const G = 3.999843853973347
  let Q = 0.7071752369554196
  let K = Math.tan((Math.PI * f0) / sampleRate)
  const Vh = 10 ** (G / 20)
  const Vb = Vh ** 0.4996667741545416
  let a0 = 1 + K / Q + K * K
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  }

  // 2 段目: 低域カット（RLB）
  f0 = 38.13547087602444
  Q = 0.5003270373238773
  K = Math.tan((Math.PI * f0) / sampleRate)
  a0 = 1 + K / Q + K * K
  const highpass = {
    b: [1, -2, 1],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  }

  return { shelf, highpass }
}

/**
 * チャンネルごとの重み。
 * 5.1ch（Web Audio の並びで L R C LFE Ls Rs）はサラウンドを 1.41 倍、LFE は数えない。
 * それ以外（モノラル / ステレオなど）は全チャンネル 1。
 */
export function channelWeights(count) {
  if (count === 6) return [1, 1, 1, 0, 1.41, 1.41]
  return Array.from({ length: count }, () => 1)
}

export class LoudnessMeter {
  #segmentLength
  #weights
  #coefficients
  /** チャンネルごとのフィルタの状態 [s1, s2, h1, h2]（転置直接形 II） */
  #filterState
  /** トゥルーピーク用に持ち越す直前のサンプル */
  #history
  /** 100 ms ごとの、重み付きの二乗和（全チャンネル分） */
  #segments = []
  #samples = 0
  #peak = 0

  /**
   * @param {{sampleRate: number, channelCount: number}} options
   */
  constructor({ sampleRate, channelCount }) {
    this.#segmentLength = Math.round(sampleRate * SEGMENT_SECONDS)
    this.#weights = channelWeights(channelCount)
    this.#coefficients = kWeightingCoefficients(sampleRate)
    this.#filterState = Array.from({ length: channelCount }, () => new Float64Array(4))
    this.#history = Array.from({ length: channelCount }, () => new Float32Array(TAPS - 1))
  }

  /**
   * 音を流し込む。チャンネルごとの配列で、長さは揃えて渡すこと。
   * @param {Float32Array[]} channels
   */
  push(channels) {
    const length = channels[0]?.length ?? 0
    if (length === 0) return

    channels.forEach((data, channel) => this.#measurePeak(channel, data))

    let offset = 0
    while (offset < length) {
      const position = this.#samples + offset
      const segment = Math.floor(position / this.#segmentLength)
      const end = Math.min(length, (segment + 1) * this.#segmentLength - this.#samples)
      if (this.#segments.length <= segment) this.#segments.push(0)

      let energy = 0
      channels.forEach((data, channel) => {
        const weight = this.#weights[channel]
        const sum = this.#filterRange(channel, data, offset, end)
        if (weight) energy += weight * sum
      })
      this.#segments[segment] += energy
      offset = end
    }

    this.#samples += length
  }

  /**
   * @returns {{integrated: number, truePeak: number}}
   *   integrated: LUFS（無音などで測れなければ -Infinity）/ truePeak: dBTP
   */
  get result() {
    return {
      integrated: this.#integrated(),
      truePeak: this.#peak > 0 ? 20 * Math.log10(this.#peak) : -Infinity
    }
  }

  #integrated() {
    // 最後の、100 ms に満たない区間はブロックに含めない
    const complete = Math.floor(this.#samples / this.#segmentLength)
    const blockLength = this.#segmentLength * SEGMENTS_PER_BLOCK
    const blocks = []
    for (let start = 0; start + SEGMENTS_PER_BLOCK <= complete; start += 1) {
      let energy = 0
      for (let i = 0; i < SEGMENTS_PER_BLOCK; i += 1) energy += this.#segments[start + i]
      blocks.push(energy / blockLength)
    }

    const aboveAbsolute = blocks.filter((power) => powerToLufs(power) > ABSOLUTE_GATE_LUFS)
    if (aboveAbsolute.length === 0) return -Infinity

    const relativeGate = powerToLufs(mean(aboveAbsolute)) + RELATIVE_GATE_LU
    const gated = aboveAbsolute.filter((power) => powerToLufs(power) > relativeGate)
    return gated.length > 0 ? powerToLufs(mean(gated)) : -Infinity
  }

  /** K 特性を通しながら二乗和を取る。フィルタの状態は次の呼び出しへ持ち越す */
  #filterRange(channel, data, start, end) {
    const { shelf, highpass } = this.#coefficients
    const [sb0, sb1, sb2] = shelf.b
    const [sa1, sa2] = shelf.a
    const [hb0, hb1, hb2] = highpass.b
    const [ha1, ha2] = highpass.a
    const state = this.#filterState[channel]
    let [s1, s2, h1, h2] = state
    let sum = 0

    for (let i = start; i < end; i += 1) {
      const x = data[i]
      const y = sb0 * x + s1
      s1 = sb1 * x - sa1 * y + s2
      s2 = sb2 * x - sa2 * y
      const z = hb0 * y + h1
      h1 = hb1 * y - ha1 * z + h2
      h2 = hb2 * y - ha2 * z
      sum += z * z
    }

    state[0] = s1
    state[1] = s2
    state[2] = h1
    state[3] = h2
    return sum
  }

  #measurePeak(channel, data) {
    const history = this.#history[channel]
    const keep = history.length
    const buffer = new Float32Array(keep + data.length)
    buffer.set(history)
    buffer.set(data, keep)

    let peak = this.#peak
    for (let n = keep; n < buffer.length; n += 1) {
      const sample = Math.abs(buffer[n])
      if (sample > peak) peak = sample
      const base = n - keep
      for (let phase = 0; phase < TRUE_PEAK_PHASES.length; phase += 1) {
        const offset = phase * TAPS
        let acc = 0
        for (let k = 0; k < TAPS; k += 1) acc += TRUE_PEAK_KERNEL[offset + k] * buffer[base + k]
        if (acc < 0) acc = -acc
        if (acc > peak) peak = acc
      }
    }
    this.#peak = peak
    history.set(buffer.subarray(buffer.length - keep))
  }
}

function mean(values) {
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}
