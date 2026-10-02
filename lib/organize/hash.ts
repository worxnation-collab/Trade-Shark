/** Bit distance between two hex dHash strings (pure, no image deps). */
export function hamming(a: string, b: string) {
  if (a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}
