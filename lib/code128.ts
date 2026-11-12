// Code 128 (character set B): the barcode USB and phone scanners read by default.
// Each pattern lists alternating bar and space widths, in modules.
const PATTERNS = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 " +
  "123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 " +
  "232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 " +
  "313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 " +
  "111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 " +
  "114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112"
).split(" ");

const START_B = 104;
const STOP = 106;

/** Bar positions in modules, or null when the text has characters Code 128 B can't carry. */
export function encodeCode128(text: string): { bars: { x: number; width: number }[]; modules: number } | null {
  if (!text) return null;

  const codes = [START_B];
  for (const char of text) {
    const code = char.charCodeAt(0) - 32;
    if (code < 0 || code > 94) return null;
    codes.push(code);
  }
  const checksum = codes.reduce((sum, code, i) => sum + code * Math.max(i, 1), 0) % 103;
  codes.push(checksum, STOP);

  const bars: { x: number; width: number }[] = [];
  let x = 0;
  for (const code of codes) {
    [...PATTERNS[code]].forEach((digit, i) => {
      const width = Number(digit);
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    });
  }
  return { bars, modules: x };
}
