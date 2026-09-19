import { DownloadSimple, FileCode } from "@phosphor-icons/react";
import type { MachiningSide, Operation, Program } from "../../types";
import { fmt } from "../format";
import { download } from "../download";
interface Props {
  activeSide: MachiningSide;
  activeFilename: string;
  activeCode: string;
  activeOperation?: Operation;
  program?: Program;
  currentLine: number;
}
export default function CodePanel({
  activeSide,
  activeFilename,
  activeCode,
  activeOperation,
  program,
  currentLine,
}: Props) {
  return (
    <>
      <section className="panel-section">
        <div className="section-title">
          <h3>{activeSide.toUpperCase()} program</h3>
          <FileCode size={15} />
        </div>
        <div className="file-detail">
          <strong>{activeFilename}</strong>
          <small>
            {fmt(new Blob([activeCode]).size / 1024)} KB ·{" "}
            {activeOperation?.lines ??
              program?.lines ??
              activeCode.split("\n").length}{" "}
            lines
          </small>
        </div>
        <button
          className="button full"
          onClick={() => download(activeFilename, activeCode, "text/plain")}
        >
          <DownloadSimple size={15} />
          Download G-code
        </button>
      </section>
      <div className="code-caption">
        First 200 lines · current line {currentLine}
      </div>
      <div className="code-preview">
        {activeCode
          .split("\n")
          .slice(0, 200)
          .map((line, i) => (
            <div className={i + 1 === currentLine ? "current" : ""} key={i}>
              <span>{i + 1}</span>
              <code>{line || " "}</code>
            </div>
          ))}
      </div>
    </>
  );
}
