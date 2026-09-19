import type { RefObject } from "react";
interface Props {
  bottomInput: RefObject<HTMLInputElement | null>;
  fileInput: RefObject<HTMLInputElement | null>;
  mksInput: RefObject<HTMLInputElement | null>;
  importFile: (file?: File) => Promise<void>;
  importBottom: (file?: File) => Promise<void>;
}
export default function WorkspaceFileInputs({
  bottomInput,
  fileInput,
  mksInput,
  importFile,
  importBottom,
}: Props) {
  return (
    <>
      <input
        ref={bottomInput}
        type="file"
        className="sr-only"
        aria-label="Upload BOTTOM G-code"
        accept=".nc,.gcode,.gco,.tap,.txt,.cnc,.ngc,.gc,.ncc"
        onChange={(e) => {
          void importBottom(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        aria-label="Upload G-code or project"
        accept=".nc,.gcode,.gco,.tap,.txt,.cnc,.ngc,.gc,.ncc,.json"
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={mksInput}
        type="file"
        className="sr-only"
        aria-label="Upload matching Makera Studio project"
        accept=".mks"
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}
