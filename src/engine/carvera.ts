/**
 * Carvera controller commands that do not describe a cutting path.
 * Keep parameter ownership explicit: S is often a percentage, and XYZ can be
 * tool-setter parameters rather than modal movement.
 */
export const CARVERA_COMMANDS = new Map<
  number,
  {
    parameters: string;
    effect:
      | "accessory"
      | "pause"
      | "feed"
      | "rpm"
      | "tool"
      | "calibrate"
      | "position";
  }
>([
  [6, { parameters: "TCSRXYZ", effect: "tool" }],
  [106, { parameters: "S", effect: "accessory" }],
  [107, { parameters: "", effect: "accessory" }],
  [117, { parameters: "", effect: "accessory" }],
  [118, { parameters: "", effect: "accessory" }],
  [118.1, { parameters: "", effect: "accessory" }],
  [220, { parameters: "S", effect: "feed" }],
  [223, { parameters: "S", effect: "rpm" }],
  [322, { parameters: "", effect: "accessory" }],
  [322.2, { parameters: "", effect: "accessory" }],
  [324, { parameters: "", effect: "accessory" }],
  [325, { parameters: "S", effect: "accessory" }],
  [331, { parameters: "", effect: "accessory" }],
  [331.3, { parameters: "", effect: "accessory" }],
  [332, { parameters: "", effect: "accessory" }],
  [332.3, { parameters: "", effect: "accessory" }],
  [333, { parameters: "", effect: "pause" }],
  [334, { parameters: "", effect: "pause" }],
  [335, { parameters: "", effect: "pause" }],
  [336, { parameters: "", effect: "pause" }],
  [337, { parameters: "RUB", effect: "accessory" }],
  [370, { parameters: "", effect: "accessory" }],
  [400, { parameters: "", effect: "accessory" }],
  [470, { parameters: "S", effect: "accessory" }],
  [471, { parameters: "", effect: "accessory" }],
  [472, { parameters: "", effect: "accessory" }],
  [485, { parameters: "", effect: "accessory" }],
  [485.1, { parameters: "", effect: "accessory" }],
  [485.2, { parameters: "", effect: "accessory" }],
  [490, { parameters: "", effect: "accessory" }],
  [490.1, { parameters: "", effect: "accessory" }],
  [490.2, { parameters: "", effect: "accessory" }],
  [490.3, { parameters: "", effect: "pause" }],
  [490.4, { parameters: "", effect: "pause" }],
  [491, { parameters: "XYZR", effect: "calibrate" }],
  [491.1, { parameters: "H", effect: "calibrate" }],
  [491.2, { parameters: "HP", effect: "accessory" }],
  [492, { parameters: "", effect: "accessory" }],
  [492.1, { parameters: "", effect: "accessory" }],
  [492.2, { parameters: "", effect: "accessory" }],
  [492.3, { parameters: "", effect: "accessory" }],
  [493.2, { parameters: "T", effect: "tool" }],
  [493.4, { parameters: "", effect: "accessory" }],
  [493.5, { parameters: "T", effect: "accessory" }],
  [493.6, { parameters: "S", effect: "accessory" }],
  [494, { parameters: "", effect: "accessory" }],
  [494.1, { parameters: "", effect: "accessory" }],
  [494.2, { parameters: "", effect: "accessory" }],
  [496, { parameters: "", effect: "position" }],
  [496.1, { parameters: "", effect: "position" }],
  [496.2, { parameters: "", effect: "position" }],
  [496.3, { parameters: "", effect: "position" }],
  [496.4, { parameters: "", effect: "position" }],
  [496.5, { parameters: "XY", effect: "position" }],
  [496.6, { parameters: "XY", effect: "position" }],
  [600, { parameters: "", effect: "pause" }],
  [801, { parameters: "S", effect: "accessory" }],
  [802, { parameters: "", effect: "accessory" }],
  [811, { parameters: "S", effect: "accessory" }],
  [812, { parameters: "", effect: "accessory" }],
  [821, { parameters: "", effect: "accessory" }],
  [822, { parameters: "", effect: "accessory" }],
  [831, { parameters: "", effect: "accessory" }],
  [832, { parameters: "", effect: "accessory" }],
  [841, { parameters: "", effect: "accessory" }],
  [842, { parameters: "", effect: "accessory" }],
  [851, { parameters: "S", effect: "accessory" }],
  [852, { parameters: "", effect: "accessory" }],
]);

/** Explain known commands that need information an NC file cannot supply. */
export function unsupportedCarveraCommand(letter: string, value: number) {
  const code = `${letter}${value}`;
  if (letter === "M") {
    if (value === 321 || value === 321.2 || value === 323)
      return `${code} enables laser operation, which is not supported by this milling simulation.`;
    if ((value >= 460 && value < 470) || value === 495 || value === 495.3)
      return `${code} requires live probing/calibration results. Import the milling toolpath after probing; measured work offsets and leveling cannot be inferred from this file.`;
    if (value === 493 || value === 493.1 || value === 493.3)
      return `${code} changes tool offsets using machine calibration data, which is not available in this file.`;
  }
  if (letter === "G") {
    if (value >= 38 && value < 39)
      return `${code} requires a measured probe contact position, which is not available in this file.`;
    if (value === 30 || value === 30.1)
      return `${code} depends on a controller-specific probe or stored position and is not supported.`;
    if (value === 92.4 || value === 92.5)
      return `${code} changes machine coordinates/calibration and is not supported by this workpiece simulation.`;
  }
  return undefined;
}
