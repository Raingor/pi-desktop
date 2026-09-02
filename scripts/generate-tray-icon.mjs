#!/usr/bin/env node
/**
 * Generates build/trayIconTemplate.png — a 16x16 monochrome template image
 * for the macOS menu bar tray icon. Template images adapt to light/dark
 * menu bars automatically.
 *
 * The icon is a simple "π" glyph drawn on a transparent background,
 * with all opaque pixels set to pure black (required for template images).
 *
 * Run: node scripts/generate-tray-icon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "build");
const outFile = path.join(outDir, "trayIconTemplate.png");

// ─── Minimal PNG encoder (RGBA, 8-bit) ──────────────────
// CRC32 table
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = data.length;
  const out = new Uint8Array(12 + len);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len); // length
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + len));
  dv.setUint32(8 + len, crc);
  return out;
}

function encodePNG(width, height, rgba) {
  // PNG signature
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  dv.setUint8(8, 8); // bit depth
  dv.setUint8(9, 6); // color type: RGBA
  dv.setUint8(10, 0); // compression
  dv.setUint11?.(11, 0); // filter (noop if not present)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // IDAT: raw pixel data with filter byte per scanline, then deflate
  // For simplicity, we use uncompressed deflate (stored blocks).
  const scanlines = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * 4)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      scanlines[dstIdx] = rgba[srcIdx];
      scanlines[dstIdx + 1] = rgba[srcIdx + 1];
      scanlines[dstIdx + 2] = rgba[srcIdx + 2];
      scanlines[dstIdx + 3] = rgba[srcIdx + 3];
    }
  }

  // Deflate stored blocks
  const raw = scanlines;
  const blockSize = 65535;
  const blocks = [];
  for (let i = 0; i < raw.length; i += blockSize) {
    const end = Math.min(i + blockSize, raw.length);
    const isLast = end >= raw.length;
    const blockData = raw.subarray(i, end);
    const block = new Uint8Array(5 + blockData.length);
    block[0] = isLast ? 1 : 0;
    const bdv = new DataView(block.buffer);
    bdv.setUint16(1, blockData.length, true);
    bdv.setUint16(3, blockData.length ^ 0xffff, true);
    block.set(blockData, 5);
    blocks.push(block);
  }
  // zlib header (CMF=0x78, FLG=0x01 for no compression level)
  const zlibHeader = new Uint8Array([0x78, 0x01]);
  const idatData = new Uint8Array(
    2 + blocks.reduce((a, b) => a + b.length, 0) + 4
  );
  idatData.set(zlibHeader, 0);
  let offset = 2;
  for (const b of blocks) {
    idatData.set(b, offset);
    offset += b.length;
  }
  // adler32 of raw data
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  const adv = new DataView(idatData.buffer);
  adv.setUint32(offset, adler);

  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", idatData);
  const iendChunk = chunk("IEND", new Uint8Array(0));

  const totalLen = sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(totalLen);
  let pos = 0;
  png.set(sig, pos); pos += sig.length;
  png.set(ihdrChunk, pos); pos += ihdrChunk.length;
  png.set(idatChunk, pos); pos += idatChunk.length;
  png.set(iendChunk, pos);
  return png;
}

// ─── Draw a π glyph at 16x16 ─────────────────────────────
// We draw a simple π: a horizontal top bar, two vertical legs.
// Template image: black pixels (rgba 0,0,0,255), transparent elsewhere.

const W = 32, H = 32;
const rgba = new Uint8Array(W * H * 4);

function setPixel(x, y, alpha = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const idx = (y * W + x) * 4;
  rgba[idx] = 0;     // R
  rgba[idx + 1] = 0; // G
  rgba[idx + 2] = 0; // B
  rgba[idx + 3] = alpha; // A
}

function fillRect(x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      setPixel(x, y);
    }
  }
}

// Clear (transparent)
for (let i = 0; i < rgba.length; i++) rgba[i] = 0;

// Draw a bold π at 32x32: a thick top bar + two legs + side hooks.
// Top bar (y=9..13, x=7..24) — 5px thick
fillRect(7, 9, 24, 13);
// Left leg (x=7..11, y=9..24)
fillRect(7, 9, 11, 24);
// Right leg (x=20..24, y=9..24)
fillRect(20, 9, 24, 24);
// Left top hook (x=4..7, y=9..14)
fillRect(4, 9, 7, 14);
// Right top hook (x=24..27, y=9..14)
fillRect(24, 9, 27, 14);

// Encode & write
const png = encodePNG(W, H, rgba);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, png);
console.log(`✓ Generated ${path.relative(root, outFile)} (${png.length} bytes)`);
