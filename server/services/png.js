// Magic-Bytes-Check fuer Signatur-Uploads: nur echte PNGs auf die Platte,
// sonst bricht spaeter doc.embedPng() den PDF-Export.
const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const isPng = (buf) =>
  Buffer.isBuffer(buf) && buf.length > MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC)
