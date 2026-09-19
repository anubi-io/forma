export type Word = [letter: string, value: number];

const digit = (c: number) => c >= 48 && c <= 57;
const whitespace = (c: number) =>
  c === 32 || c === 9 || c === 10 || c === 13 || c === 0xfeff;

/** Scan one NC block without allocating stripped/uppercase copies or comments. */
export function lexLine(line: string): Word[] {
  const words: Word[] = [];
  let i = 0;
  let marker = false;
  while (i < line.length) {
    let c = line.charCodeAt(i);
    if (whitespace(c)) {
      i++;
      continue;
    }
    if (c === 59) break;
    if (c === 40) {
      let depth = 1;
      while (++i < line.length && depth) {
        c = line.charCodeAt(i);
        if (c === 40) depth++;
        else if (c === 41) depth--;
      }
      if (depth) throw new Error("unclosed comment.");
      continue;
    }
    if (c === 37 && !words.length && !marker) {
      marker = true;
      i++;
      continue;
    }
    if (marker) throw new Error("invalid % marker.");
    if (c === 42) {
      const end = i++;
      const start = i;
      while (digit(line.charCodeAt(i))) i++;
      if (i === start) throw new Error("invalid checksum.");
      const expected = Number(line.slice(start, i));
      let actual = 0;
      for (let n = 0; n < end; n++) actual ^= line.charCodeAt(n);
      if (expected > 255 || actual !== expected)
        throw new Error("invalid checksum.");
      while (whitespace(line.charCodeAt(i))) i++;
      if (i < line.length && line.charCodeAt(i) !== 59)
        throw new Error("unsupported syntax after checksum.");
      break;
    }
    if (c === 35 || c === 91 || c === 93 || c === 61)
      throw new Error(
        "macros or expressions are not supported. Export explicit XYZ toolpaths.",
      );
    if (c >= 97 && c <= 122) c -= 32;
    if (c < 65 || c > 90) throw new Error("unsupported syntax.");
    const letter = String.fromCharCode(c);
    i++;
    while (whitespace(line.charCodeAt(i))) i++;
    const start = i;
    c = line.charCodeAt(i);
    if (c === 43 || c === 45) i++;
    let digits = 0;
    while (digit(line.charCodeAt(i))) {
      i++;
      digits++;
    }
    if (line.charCodeAt(i) === 46) {
      i++;
      while (digit(line.charCodeAt(i))) {
        i++;
        digits++;
      }
    }
    if (!digits) throw new Error(`invalid ${letter} value.`);
    const value = Number(line.slice(start, i));
    if (!Number.isFinite(value) || Math.abs(value) > 1e7)
      throw new Error("value out of range.");
    words.push([letter, value]);
    // Carvera message commands own the remainder of the line as text, even
    // when it contains G-code-looking words or diagnostic macro expressions.
    if (letter === "M" && [117, 118, 118.1].includes(value)) break;
  }
  return words;
}
