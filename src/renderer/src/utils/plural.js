/**
 * 数と単語を英語の単数・複数にそろえて返す。
 * 例: count(1, 'track') -> '1 track'、count(3, 'track') -> '3 tracks'
 * @param {number} n
 * @param {string} word 単数形
 * @param {string} [plural] 不規則な複数形（省略時は s を付ける）
 */
export function count(n, word, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`
}
