import { ArrowSquareOut, CaretRight, Cylinder } from "@phosphor-icons/react";
import catalog from "../../data/makera.json";
import type { Assignments, Program, Tool } from "../../types";
const LIBRARY = catalog.tools as Tool[];
const kindNames = {
  flat: "Flat end mill",
  ball: "Ball nose",
  v: "V-bit",
  unsupported: "Special profile",
  thread: "Thread mill",
};

interface Props {
  assignments: Assignments;
  toolNumbers: number[];
  program?: Program;
  demo: boolean;
  code: string;
  setToolModal: (number: number) => void;
  onSetup: () => void;
}
export default function ToolsPanel({
  assignments,
  toolNumbers,
  program,
  demo,
  code,
  setToolModal,
  onSetup,
}: Props) {
  return (
    <>
      <section className="panel-section">
        <div className="section-title">
          <h3>Program tools</h3>
          <span>
            {toolNumbers.length} {toolNumbers.length === 1 ? "tool" : "tools"}
          </span>
        </div>

        {!demo && code.trim() && (
          <button className="button small" onClick={onSetup}>
            Import stock &amp; tools from .mks
          </button>
        )}
        <p className="setup-help">
          Carvera changes tools automatically at T… M6. Assign each T number to
          the cutter it loads; G-code alone does not describe its shape or size.
        </p>
        <div className="assigned-tools">
          {toolNumbers.map((n) => {
            const t = assignments[n];
            return (
              <button
                className={`assigned-tool ${!t ? "unassigned" : ""}`}
                key={n}
                onClick={() => setToolModal(n)}
              >
                <span className="tool-number">T{n}</span>
                <div>
                  <strong>
                    {t
                      ? `${kindNames[t.kind]} · Ø ${t.diameter}`
                      : "Assign a tool"}
                  </strong>
                  <small>
                    {t
                      ? t.name.split(" · ")[0]
                      : program?.tools.includes(n)
                        ? "Required for simulation"
                        : "No cutting moves · optional"}
                  </small>
                </div>
                <CaretRight size={14} />
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel-section">
        <div className="library-promo">
          <Cylinder size={22} />
          <h3>Makera library</h3>
          <p>{LIBRARY.length} tools</p>
          <button
            className="button"
            onClick={() => setToolModal(toolNumbers[0] ?? 1)}
          >
            Browse library <ArrowSquareOut size={14} />
          </button>
        </div>
      </section>
    </>
  );
}
