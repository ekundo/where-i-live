// Генерирует PNG-иконки без зависимостей: node tools/make-icons.js
// Левая половина цвета мамы, правая цвета папы, по центру белый домик.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MOM = [0xF2, 0x8B, 0x78];
const DAD = [0x6F, 0xA8, 0xE8];
const WHITE = [255, 255, 255];

// Координаты домика в долях стороны; укладывается в безопасную зону maskable-иконки.
function inHouse(x, y) {
  const roof = y >= 0.22 && y <= 0.47 && Math.abs(x - 0.5) <= (y - 0.22) * 1.12;
  const body = y >= 0.46 && y <= 0.76 && x >= 0.30 && x <= 0.70;
  const door = y >= 0.58 && y <= 0.76 && x >= 0.45 && x <= 0.55;
  return (roof || body) && !door;
}

function pixel(x, y) {
  if (inHouse(x, y)) return WHITE;
  return x < 0.5 ? MOM : DAD;
}

function render(size) {
  const ss = 4; // суперсэмплинг для сглаживания
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = pixel((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      raw[o] = Math.round(r / ss / ss);
      raw[o + 1] = Math.round(g / ss / ss);
      raw[o + 2] = Math.round(b / ss / ss);
    }
  }
  return png(size, size, raw);
}

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  fs.writeFileSync(path.join(out, name), render(size));
  console.log(name, size);
}
