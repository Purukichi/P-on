/**
 * dB / LUFS の数字の書き方。既定は小数 1 桁。
 * 負の数はハイフンでなくマイナス記号（−）で出す（数字の幅に揃い、読み違えにくい）。
 *
 * @param {number} value
 * @param {{sign?: boolean, digits?: number}} [options] sign: 正の数にも + を付ける
 */
export function formatDb(value, { sign = false, digits = 1 } = {}) {
  const rounded = Number(value.toFixed(digits))
  const text = Math.abs(rounded).toFixed(digits)
  if (rounded < 0) return `−${text}`
  return sign ? `+${text}` : text
}
