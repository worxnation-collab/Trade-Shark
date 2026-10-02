/**
 * Read scan resolution from the file header (JFIF density, EXIF XResolution, or PNG pHYs).
 * Copier scans almost always carry it; it tells the detector how big one card is.
 */
export function readDpi(buf: ArrayBuffer): number | undefined {
  const b = new DataView(buf);
  if (b.byteLength < 24) return undefined;
  // PNG
  if (b.getUint32(0) === 0x89504e47) {
    let off = 8;
    while (off + 12 <= b.byteLength) {
      const len = b.getUint32(off);
      const type = String.fromCharCode(b.getUint8(off + 4), b.getUint8(off + 5), b.getUint8(off + 6), b.getUint8(off + 7));
      if (type === "pHYs" && len >= 9) {
        const ppu = b.getUint32(off + 8);
        const unit = b.getUint8(off + 16);
        return unit === 1 ? Math.round(ppu * 0.0254) : undefined;
      }
      if (type === "IDAT") return undefined;
      off += 12 + len;
    }
    return undefined;
  }
  // JPEG
  if (b.getUint16(0) !== 0xffd8) return undefined;
  let off = 2;
  while (off + 4 <= b.byteLength) {
    if (b.getUint8(off) !== 0xff) return undefined;
    const marker = b.getUint8(off + 1);
    const len = b.getUint16(off + 2);
    const seg = off + 4;
    if (marker === 0xe0 && len >= 14 && String.fromCharCode(...new Uint8Array(buf, seg, 4)) === "JFIF") {
      const unit = b.getUint8(seg + 7);
      const x = b.getUint16(seg + 8);
      if (unit === 1 && x > 1) return x;
      if (unit === 2 && x > 1) return Math.round(x * 2.54);
    }
    if (marker === 0xe1 && len >= 16 && String.fromCharCode(...new Uint8Array(buf, seg, 4)) === "Exif") {
      const dpi = exifXRes(b, seg + 6);
      if (dpi) return dpi;
    }
    if (marker === 0xda) return undefined; // start of scan: no more headers
    off += 2 + len;
  }
  return undefined;
}

function exifXRes(b: DataView, tiff: number): number | undefined {
  try {
    const le = b.getUint16(tiff) === 0x4949;
    const u16 = (o: number) => b.getUint16(o, le);
    const u32 = (o: number) => b.getUint32(o, le);
    const ifd = tiff + u32(tiff + 4);
    const n = u16(ifd);
    let xres: number | undefined;
    let unit = 2;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e);
      if (tag === 0x011a) {
        const vo = tiff + u32(e + 8);
        xres = u32(vo) / (u32(vo + 4) || 1);
      } else if (tag === 0x0128) unit = u16(e + 8);
    }
    if (!xres || xres <= 1) return undefined;
    return Math.round(unit === 3 ? xres * 2.54 : xres);
  } catch {
    return undefined;
  }
}
