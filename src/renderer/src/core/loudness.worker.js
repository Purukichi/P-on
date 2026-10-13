import { LoudnessMeter } from './loudness-meter.js'

/**
 * 測定は 1 曲で数十億回の掛け算になるので、画面が固まらないよう Worker に逃がしている。
 * 音は少しずつ届き、届くたびに 'ack' を返す（返事を待ってから次を送ってもらうことで、
 * 複製が溜まって曲 1 本ぶん余計にメモリを食わないようにしている）。
 */
let meter = null

self.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'start':
      meter = new LoudnessMeter(data)
      self.postMessage({ type: 'ack' })
      break
    case 'chunk':
      meter?.push(data.channels)
      self.postMessage({ type: 'ack' })
      break
    case 'finish':
      self.postMessage({ type: 'result', ...(meter?.result ?? {}) })
      meter = null
      break
  }
})
