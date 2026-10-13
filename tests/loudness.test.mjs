import test from 'node:test'
import assert from 'node:assert/strict'
import { LoudnessMeter, kWeightingCoefficients } from '../src/renderer/src/core/loudness-meter.js'
import {
  SPOTIFY_PROFILE as spotify,
  combineMeasurements,
  normalizationGainDb
} from '../src/renderer/src/core/Loudness.js'

const RATE = 48000

function sine({ seconds, frequency = 1000, dbfs, phase = 0 }) {
  const amplitude = 10 ** (dbfs / 20)
  const data = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < data.length; i += 1) {
    data[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE + phase)
  }
  return data
}

function measure(channels, chunk = RATE) {
  const meter = new LoudnessMeter({ sampleRate: RATE, channelCount: channels.length })
  for (let offset = 0; offset < channels[0].length; offset += chunk) {
    meter.push(channels.map((data) => data.subarray(offset, offset + chunk)))
  }
  return meter.result
}

test('K 特性フィルタの係数は 48 kHz で BS.1770 の表と一致する', () => {
  const { shelf, highpass } = kWeightingCoefficients(RATE)
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
  close(shelf.b[0], 1.53512485958697)
  close(shelf.b[1], -2.69169618940638)
  close(shelf.b[2], 1.19839281085285)
  close(shelf.a[0], -1.69065929318241)
  close(shelf.a[1], 0.73248077421585)
  close(highpass.a[0], -1.99004745483398)
  close(highpass.a[1], 0.99007225036621)
})

test('EBU Tech 3341: ステレオの 1 kHz・-23 dBFS は -23 LUFS', () => {
  const tone = sine({ seconds: 20, dbfs: -23 })
  const { integrated } = measure([tone, tone])
  assert.ok(Math.abs(integrated - -23) < 0.1, `got ${integrated}`)
})

test('チャンクの切り方が変わっても結果は同じ', () => {
  const tone = sine({ seconds: 5, frequency: 440, dbfs: -18 })
  const a = measure([tone, tone], 4800)
  const b = measure([tone, tone], 12345)
  assert.ok(Math.abs(a.integrated - b.integrated) < 1e-6)
  assert.ok(Math.abs(a.truePeak - b.truePeak) < 1e-6)
})

test('EBU Tech 3341 #3/#4: 相対ゲートで静かな部分が除かれる', () => {
  // -36 / -23 / -36 dBFS が 10 / 60 / 10 秒。静かな区間は相対ゲートで捨てられ -23 LUFS になる
  const parts = [
    sine({ seconds: 10, dbfs: -36 }),
    sine({ seconds: 60, dbfs: -23 }),
    sine({ seconds: 10, dbfs: -36 })
  ]
  const tone = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    tone.set(part, offset)
    offset += part.length
  }
  const { integrated } = measure([tone, tone])
  assert.ok(Math.abs(integrated - -23) < 0.1, `got ${integrated}`)
})

test('無音は測れない（-Infinity）', () => {
  const silence = new Float32Array(RATE * 3)
  const { integrated, truePeak } = measure([silence, silence])
  assert.equal(integrated, -Infinity)
  assert.equal(truePeak, -Infinity)
})

test('トゥルーピークはサンプルの間の山を拾う', () => {
  // fs/4 の正弦波を 45° ずらすと、サンプル値は振幅の 0.707 倍にしかならない（約 -3 dB）
  const tone = sine({ seconds: 1, frequency: RATE / 4, dbfs: 0, phase: Math.PI / 4 })
  const samplePeak = 20 * Math.log10(Math.max(...tone.map(Math.abs)))
  const { truePeak } = measure([tone])
  assert.ok(samplePeak < -2.9)
  assert.ok(Math.abs(truePeak) < 0.6, `got ${truePeak}`)
})

test('目標より大きい曲はそのぶん下げる', () => {
  assert.equal(normalizationGainDb({ integrated: -8, truePeak: 0.5 }, spotify), -6)
})

test('Spotify: 小さい曲はトゥルーピーク -1 dBTP（非可逆）まで持ち上げる', () => {
  // Spotify の説明にある例: トゥルーピーク -5 dB の曲は -16 LUFS 前後までしか上がらない
  assert.equal(normalizationGainDb({ integrated: -20, truePeak: -5 }, spotify), 4)
  // 余白が十分あれば目標まで上げる
  assert.equal(normalizationGainDb({ integrated: -20, truePeak: -10 }, spotify), 6)
})

test('Spotify: 可逆の音源は 0 dBTP まで持ち上げる', () => {
  assert.equal(normalizationGainDb({ integrated: -20, truePeak: -5 }, spotify, { lossless: true }), 5)
})

test('ピークがすでに上限を越えている小さい曲は上げも下げもしない', () => {
  assert.equal(normalizationGainDb({ integrated: -20, truePeak: 0 }, spotify), 0)
})

test('測れなかった曲はそのまま', () => {
  assert.equal(normalizationGainDb({ integrated: null, truePeak: null }, spotify), 0)
  assert.equal(normalizationGainDb(null, spotify), 0)
})

function concat(...parts) {
  const out = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

test('アルバム: 1 曲だけなら曲の値と同じ', () => {
  const tone = sine({ seconds: 10, frequency: 440, dbfs: -12 })
  const track = measure([tone, tone])
  const album = combineMeasurements([track])
  assert.ok(Math.abs(album.integrated - track.integrated) < 0.01, `${album.integrated} vs ${track.integrated}`)
  assert.equal(album.truePeak, track.truePeak)
})

test('アルバム: 曲ごとの分布を足すと、つなげて 1 本で測った値と一致する', () => {
  const loud = sine({ seconds: 30, frequency: 1000, dbfs: -6 })
  const soft = sine({ seconds: 60, frequency: 300, dbfs: -20 })
  const quiet = sine({ seconds: 20, frequency: 2000, dbfs: -40 })
  const tracks = [loud, soft, quiet].map((tone) => measure([tone, tone]))
  // 曲の境目をまたぐブロックの分だけずれるが、0.1 LU 刻みの分布で十分に近い
  const whole = measure([concat(loud, soft, quiet), concat(loud, soft, quiet)])
  const album = combineMeasurements(tracks)
  assert.ok(Math.abs(album.integrated - whole.integrated) < 0.15, `${album.integrated} vs ${whole.integrated}`)
  assert.equal(album.truePeak, Math.max(...tracks.map((t) => t.truePeak)))
})

test('アルバム: 静かな曲も同じ補正になる（アルバムの中で音量差を保つ）', () => {
  const loud = measure([sine({ seconds: 20, dbfs: -6 })])
  const soft = measure([sine({ seconds: 20, dbfs: -18 })])
  const album = combineMeasurements([loud, soft])
  // 大きい曲に引っ張られ、静かな曲だけの値より大きくなる
  assert.ok(album.integrated > soft.integrated + 5)
  assert.ok(normalizationGainDb(album, spotify) < normalizationGainDb(soft, spotify))
})
