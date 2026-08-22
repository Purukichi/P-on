import { splitArtists } from '../core/Track.js'
import { closestFrom, create } from './dom.js'

/**
 * アーティスト名を押せる形にして返す。
 *
 * 「A, B」のような連名は splitArtists で分解し、名前ごとに別々のボタンにする。
 * どの名前からでもその人の曲を引けるようにするため。
 * 未設定のときはただの文字列を返す（押しても行き先が無いので）。
 *
 * @param {string|null} artist
 * @param {{fallback?: string}} options
 * @returns {Node[]}
 */
export function artistLinks(artist, { fallback = 'アーティスト未設定' } = {}) {
  const names = splitArtists(artist)
  if (names.length === 0) return [document.createTextNode(fallback)]

  const nodes = []
  names.forEach((name, index) => {
    if (index > 0) nodes.push(create('span', { className: 'artistlink__sep', text: ', ' }))
    nodes.push(
      create('button', {
        className: 'artistlink',
        text: name,
        attrs: {
          type: 'button',
          'data-artist': name,
          'data-tip': `「${name}」の曲を棚で探す`
        }
      })
    )
  })
  return nodes
}

/**
 * 画面のどこにある `[data-artist]` でも拾えるよう、
 * リスナーは各所ではなくアプリのルートに 1 つだけ張る。
 *
 * 押した先は棚の検索。専用のポップアップを出すより、
 * 見慣れた検索結果の画面をそのまま使うほうが迷わない。
 *
 * @param {Element} root
 * @param {(artist: string) => void} onSelect
 */
export function bindArtistLinks(root, onSelect) {
  root.addEventListener('click', (event) => {
    const link = closestFrom(event.target, '[data-artist]')
    if (!link) return
    event.preventDefault()
    onSelect(link.dataset.artist)
  })
}
