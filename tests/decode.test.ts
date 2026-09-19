import { describe, expect, it } from "vitest";
import { decodeNc } from "../src/engine/decode";
import fixtures from "./fixtures/quicklz-reference.json";

const bytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));

describe("Makera NC import", () => {
  it("preserves ordinary UTF-8 G-code and saved JSON projects", () => {
    for (const text of [
      "G21 G90\r\n; Fine finish — 1 µm\nG1 X10",
      '{"version":1,"name":"Example"}',
    ])
      expect(decodeNc(new TextEncoder().encode(text))).toBe(text);
    expect(decodeNc(new TextEncoder().encode("\ufeffG21"))).toBe("G21");
  });

  it.each(fixtures)("decodes reference-compressed $name", ({ text, hex }) => {
    expect(decodeNc(bytes(hex))).toBe(text);
  });

  it("honors the byte offset when a file is a view into a larger buffer", () => {
    const fixture = fixtures.find(
      (fixture) => fixture.name === "multi-block-level-3",
    )!;
    const packed = bytes(fixture.hex),
      storage = new Uint8Array(packed.length + 20);
    storage.set(packed, 10);
    expect(decodeNc(storage.subarray(10, 10 + packed.length))).toBe(
      fixture.text,
    );
  });

  it("rejects truncated blocks and a corrupt checksum", () => {
    const packed = bytes(fixtures[2].hex);
    for (const length of [2, 4, 10, packed.length - 1])
      expect(() => decodeNc(packed.subarray(0, length))).toThrow(
        /damaged|incomplete/,
      );
    packed[packed.length - 1] ^= 1;
    expect(() => decodeNc(packed)).toThrow(/checksum/);
  });

  it("rejects corrupt back-references instead of manufacturing output", () => {
    // First item is a match at distance 1, but no literal exists yet.
    const packed = bytes("0000000c4d0c140100008004000000000000");
    expect(() => decodeNc(packed)).toThrow(/damaged|incomplete/);
  });

  it.each([
    [1, "0000000d4d0d080200008041043132333401ce"],
    [2, "0000000e4d0e0904000080414208313233340211"],
  ])(
    "rejects a reference closer than QuickLZ's minimum distance: %i",
    (_, hex) => {
      expect(() => decodeNc(bytes(hex as string))).toThrow(
        /damaged|incomplete/,
      );
    },
  );

  it("checks the expanded size before allocating a compressed block", () => {
    const packed = bytes("000000094f09000000010090010000");
    expect(() => decodeNc(packed)).toThrow(/25 MB/);
  });

  it("applies the size limit to the sum of decoded blocks", () => {
    const first = bytes(fixtures[0].hex).subarray(0, -2),
      second = bytes("000000094f09000000000090010000"),
      packed = new Uint8Array(first.length + second.length);
    packed.set(first);
    packed.set(second, first.length);
    // The second block advertises exactly 25 MB, exceeding the remaining budget.
    expect(() => decodeNc(packed)).toThrow(/25 MB/);
  });

  it("reports unsupported streaming and binary text clearly", () => {
    const packed = bytes(fixtures[0].hex);
    packed[4] |= 0x10;
    expect(() => decodeNc(packed)).toThrow(/streaming/);
    expect(() => decodeNc(new Uint8Array([0xff, 0xfe, 71, 0]))).toThrow(
      /encoding/,
    );
  });
});
