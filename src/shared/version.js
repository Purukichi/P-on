/*
 * スマホ版（Android / iOS）のバージョン。
 * Windows 版は package.json の version（1.3 系の安定版）をそのまま使い、ここは見ない。
 * ストアには数字だけの版が要るので、表示用・Android 用・iOS 用を分けて持つ。
 */
export const DISPLAY_VERSION = 'β2.0.0'
/** Android の versionName */
export const MOBILE_VERSION = '2.0.0-beta.0'
/** iOS の MARKETING_VERSION */
export const NATIVE_VERSION = '2.0.0'
