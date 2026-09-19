// Makera container: big-endian block lengths, independent QuickLZ 1.5 blocks,
// then a big-endian 16-bit sum of all decoded bytes. See:
// https://github.com/MakeraInc/CarveraController/blob/main/src/makera.py
// https://github.com/ReSpeak/quicklz/blob/master/Format.md
// This bounds-checked reader supports non-streaming levels 1 and 3.
const MAX_BYTES = 25 * 1024 * 1024;
const invalid = () =>
  new Error("Compressed Makera NC file is damaged or incomplete.");
const tooLarge = () =>
  new Error("The decompressed program exceeds the 25 MB limit.");

function unpackBlock(block: Uint8Array, budget: number): Uint8Array {
  if (block.length < 3) throw invalid();
  const flags = block[0],
    wide = !!(flags & 2),
    header = wide ? 9 : 3,
    level = (flags >> 2) & 3;
  if (block.length < header || (flags & 0xc0) !== 0x40) throw invalid();
  if (flags & 0x30)
    throw new Error(
      "QuickLZ streaming format is not supported. Export a Makera NC file.",
    );
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength),
    packedSize = wide ? view.getUint32(1, true) : block[1],
    size = wide ? view.getUint32(5, true) : block[2];
  if (packedSize !== block.length || !size) throw invalid();
  if (size > budget) throw tooLarge();
  if (!(flags & 1)) {
    if (block.length !== header + size) throw invalid();
    return block.subarray(header);
  }
  if (level !== 1 && level !== 3)
    throw new Error(`QuickLZ compression level ${level} is not supported.`);

  const output = new Uint8Array(size),
    offsets = level === 1 ? new Int32Array(4096).fill(-1) : undefined;
  let input = header,
    written = 0,
    control = 1,
    nextHash = 0;
  const read = (count: number): number => {
    if (input + count > block.length) throw invalid();
    let value = 0;
    for (let i = 0; i < count; i++) value += block[input++] * 2 ** (i * 8);
    return value;
  };
  const indexUntil = (end: number) => {
    if (!offsets) return;
    while (nextHash < end) {
      const value =
        output[nextHash] |
        (output[nextHash + 1] << 8) |
        (output[nextHash + 2] << 16);
      offsets[((value >>> 12) ^ value) & 4095] = nextHash++;
    }
  };
  while (written < size) {
    if (control === 1) {
      control = read(4);
      if (!(control & 0x80000000)) throw invalid();
    }
    const reference = control & 1;
    control >>>= 1;
    if (!reference) {
      output[written++] = read(1);
      indexUntil(written - 2);
      continue;
    }

    let start: number, length: number;
    const first = read(1);
    if (level === 1) {
      const token = first + read(1) * 256;
      start = offsets![token >>> 4];
      length = token & 15 ? (token & 15) + 2 : read(1);
    } else {
      let distance: number;
      if ((first & 3) === 0) {
        distance = first >>> 2;
        length = 3;
      } else if ((first & 3) === 1) {
        distance = (first + read(1) * 256) >>> 2;
        length = 3;
      } else if ((first & 3) === 2) {
        distance = (first + read(1) * 256) >>> 6;
        length = ((first >>> 2) & 15) + 3;
      } else if ((first & 127) !== 3) {
        distance = (first + read(2) * 256) >>> 7;
        length = ((first >>> 2) & 31) + 2;
      } else {
        const token = first + read(3) * 256;
        distance = token >>> 15;
        length = ((token >>> 7) & 255) + 3;
      }
      start = written - distance;
    }
    if (
      start < 0 ||
      start > written - 3 ||
      length < 3 ||
      written + length > size - 4
    )
      throw invalid();
    const previous = written;
    // A match can overlap its own output (for example a long repeated run).
    for (let i = 0; i < length; i++) output[written++] = output[start + i];
    indexUntil(previous + 1);
    nextHash = written;
  }
  // QuickLZ pads very small compressed payloads to nine bytes.
  if (input !== block.length && block.length !== header + 9) throw invalid();
  return output;
}

export function decodeNc(bytes: Uint8Array): string {
  if (bytes.length > MAX_BYTES) throw tooLarge();
  let decoded = bytes;
  // The controller uses these first two bytes to identify its compressed NCs.
  if (bytes.length >= 2 && bytes[0] === 0 && bytes[1] === 0) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      blocks: Uint8Array[] = [];
    let position = 0,
      total = 0,
      checksum = 0;
    while (position < bytes.length - 2) {
      if (position + 4 > bytes.length - 2) throw invalid();
      const length = view.getUint32(position);
      position += 4;
      if (length < 3 || position + length > bytes.length - 2) throw invalid();
      const block = unpackBlock(
        bytes.subarray(position, position + length),
        MAX_BYTES - total,
      );
      total += block.length;
      for (const byte of block) checksum = (checksum + byte) & 0xffff;
      blocks.push(block);
      position += length;
    }
    if (!blocks.length || position !== bytes.length - 2) throw invalid();
    if (checksum !== view.getUint16(position))
      throw new Error(
        "Invalid Makera NC file checksum. Export the file again.",
      );
    decoded = new Uint8Array(total);
    let offset = 0;
    for (const block of blocks) {
      decoded.set(block, offset);
      offset += block.length;
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    throw new Error(
      "Unsupported file encoding. Use UTF-8 G-code or compressed Makera NC.",
    );
  }
}
