import { useEffect, useRef, useState } from "react";
import {
  CaretLeft,
  CaretRight,
  CircleNotch,
  Crosshair,
  Info,
  Scan,
  Smiley,
  Sparkle,
  Warning,
  X,
} from "@phosphor-icons/react";
import type { AnalysisFinding } from "../engine/analyze";
import type { AnalysisState } from "../useAnalysis";
import { MATERIALS } from "../data/materials";
import "./optimization-panel.css";

const time = (seconds: number) =>
  seconds < 1
    ? "<1s"
    : seconds < 60
      ? `${Math.floor(seconds)}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
        : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
const occurrences = (findings: AnalysisFinding[]) =>
  findings.reduce((sum, finding) => sum + finding.occurrences, 0);
const titles: Partial<Record<AnalysisFinding["kind"], string>> = {
  "repeated-path": "Repeated paths",
  "empty-pass": "Empty passes",
  "steep-entry": "Entry into solid stock",
  "deep-engagement": "Deep cut",
  "spindle-unknown": "Spindle start missing",
  "missing-rpm": "RPM missing",
  "missing-feed": "Feed missing",
};

function Finding({
  finding,
  onSeek,
  canSeek,
}: {
  finding: AnalysisFinding;
  onSeek: (move: number) => void;
  canSeek: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const current = Math.min(selected, finding.locations.length - 1);
  const location = finding.locations[current];
  useEffect(() => setSelected(0), [finding]);
  const title = titles[finding.kind] ?? finding.title;
  const totalTime = finding.durationSeconds ?? finding.seconds;
  const passTime = location.durationSeconds ?? location.seconds;
  const Icon = finding.severity === "opportunity" ? Sparkle : Warning;
  const show = (index: number) => {
    setSelected(index);
    onSeek(finding.locations[index].focusMoveIndex);
  };
  return (
    <article className={`optimization-finding ${finding.severity}`}>
      <div className="optimization-finding-heading">
        <Icon size={16} aria-hidden="true" />
        <h3>{title}</h3>
        <span
          className="optimization-count"
          title={`${finding.occurrences} machining operations`}
        >
          {finding.occurrences}×
        </span>
        {totalTime > 0 && (
          <strong
            className="optimization-time"
            title="Potentially optimizable time; overlaps count once in the total"
          >
            ~{time(totalTime)}
          </strong>
        )}
      </div>
      <div className="optimization-finding-meta">
        <span>
          {finding.side.toUpperCase()} · T{finding.tool}
        </span>
        <span>Line {location.focusLine}</span>
        {passTime > 0 && <span>~{time(passTime)} this pass</span>}
      </div>
      <div className="optimization-navigation">
        <button
          className="optimization-show"
          disabled={!canSeek}
          onClick={() => show(current)}
          aria-label={`Show ${title}, occurrence ${current + 1} of ${finding.occurrences}`}
        >
          <Crosshair size={14} />
          Show in 3D
        </button>
        <div>
          <button
            aria-label={`Previous ${title}`}
            disabled={!canSeek || current === 0}
            onClick={() => show(current - 1)}
          >
            <CaretLeft size={14} />
          </button>
          <select
            aria-label={`Occurrence of ${title}`}
            value={current}
            disabled={!canSeek}
            onChange={(event) => show(Number(event.target.value))}
          >
            {finding.locations.map((location, index) => (
              <option key={location.moveIndex} value={index}>
                {index + 1} / {finding.occurrences}
              </option>
            ))}
          </select>
          <button
            aria-label={`Next ${title}`}
            disabled={!canSeek || current === finding.locations.length - 1}
            onClick={() => show(current + 1)}
          >
            <CaretRight size={14} />
          </button>
        </div>
      </div>
      <details className="optimization-evidence">
        <summary>Why?</summary>
        <p>{location.detail}</p>
        <p>{finding.suggestion}</p>
      </details>
    </article>
  );
}

export default function OptimizationPanel({
  analysis,
  material,
  onMaterialChange,
  onSeek,
  canSeek,
  programError,
}: {
  analysis: AnalysisState;
  material: string;
  onMaterialChange: (material: string) => void;
  onSeek: (move: number) => void;
  canSeek: boolean;
  programError?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"warnings" | "optimizations">(
    "optimizations",
  );
  const trigger = useRef<HTMLButtonElement>(null),
    closeButton = useRef<HTMLButtonElement>(null),
    wasOpen = useRef(false);
  const { report, status } = analysis;
  const warnings =
    report?.findings.filter((f) => f.severity !== "opportunity") ?? [];
  const opportunities =
    report?.findings.filter((f) => f.severity === "opportunity") ?? [];
  const warningCount = occurrences(warnings),
    optimizationCount = occurrences(opportunities);
  const clean =
    status === "ready" && report?.complete && !report.findings.length;
  const pending = status === "analyzing";
  const progress = Math.floor((analysis.progress ?? 0) * 100);
  const tone = warnings.some((f) => f.severity === "danger")
    ? "danger"
    : warningCount || status === "error"
      ? "warning"
      : clean
        ? "clear"
        : "neutral";
  const Icon = pending
    ? CircleNotch
    : clean
      ? Smiley
      : warningCount
        ? Warning
        : optimizationCount
          ? Sparkle
          : Scan;
  const label = pending
    ? `Checking ${progress}%`
    : status === "waiting"
      ? "Optimizations"
      : status === "error"
        ? "Analysis unavailable"
        : warningCount
          ? `${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`
          : optimizationCount
            ? `${optimizationCount} ${optimizationCount === 1 ? "optimization" : "optimizations"}`
            : clean
              ? "Looking good"
              : "Optimizations";
  const findings = filter === "optimizations" ? opportunities : warnings;
  useEffect(() => {
    if (open) closeButton.current?.focus();
    else if (wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (report)
      setFilter(
        report.findings.some((f) => f.severity !== "opportunity")
          ? "warnings"
          : "optimizations",
      );
  }, [report]);

  return (
    <div className={`optimization-overlay ${open ? "is-open" : ""}`}>
      {!open && (
        <button
          ref={trigger}
          className={`optimization-trigger ${tone}`}
          aria-expanded={false}
          aria-controls="optimization-panel"
          aria-label={`Open optimizations: ${label}`}
          onClick={() => setOpen(true)}
        >
          <Icon
            size={21}
            className={pending ? "spin" : ""}
            weight={clean ? "duotone" : "regular"}
          />
          <strong>{label}</strong>
          {!!report?.optimizableSeconds && (
            <span>~{time(report.optimizableSeconds)}</span>
          )}
          <CaretRight size={13} />
        </button>
      )}
      <span className="optimization-sr-status" role="status" aria-live="polite">
        {label}
      </span>
      {open && (
        <aside
          id="optimization-panel"
          className="optimization-panel"
          aria-label="Optimizations"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <header className="optimization-header">
            <h2>
              <Scan size={17} />
              Optimizations
            </h2>
            <button
              ref={closeButton}
              className="icon-button"
              aria-label="Close optimizations"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </button>
          </header>
          <div className="optimization-scroll">
            <div className="optimization-overview">
              <label>
                <span>Material</span>
                <select
                  aria-label="Analysis material"
                  value={material}
                  onChange={(event) => onMaterialChange(event.target.value)}
                >
                  {MATERIALS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {!!report?.optimizableSeconds && (
                <div
                  className="optimization-potential"
                  title="Time in flagged paths, not a guaranteed saving. Overlaps counted once."
                >
                  <span>Potentially optimizable time</span>
                  <strong>~{time(report.optimizableSeconds)}</strong>
                  <small>
                    {(
                      (report.optimizableSeconds / report.totalSeconds) *
                      100
                    ).toFixed(1)}
                    %
                  </small>
                </div>
              )}
            </div>
            {pending ? (
              <div className="optimization-empty">
                <CircleNotch size={26} className="spin" />
                <p>Checking the full program · {progress}%</p>
                <progress
                  aria-label="G-code analysis"
                  value={analysis.progress ?? 0}
                  max={1}
                />
              </div>
            ) : status === "waiting" || status === "error" ? (
              <div className="optimization-empty">
                <Info size={26} />
                <p>
                  {analysis.error ||
                    programError ||
                    "Load a program to check its toolpaths."}
                </p>
              </div>
            ) : (
              report && (
                <>
                  {clean && (
                    <div className="optimization-empty optimization-happy">
                      <Smiley size={42} weight="duotone" />
                      <p>No issues found.</p>
                    </div>
                  )}
                  {!clean && !report.findings.length && (
                    <div className="optimization-empty">
                      <p>No suggestions.</p>
                    </div>
                  )}
                  {!!report.findings.length && (
                    <>
                      <div
                        className="optimization-filters"
                        role="group"
                        aria-label="Filter insights"
                      >
                        <button
                          aria-pressed={filter === "optimizations"}
                          onClick={() => setFilter("optimizations")}
                        >
                          <Sparkle size={13} />
                          Optimize<span>{optimizationCount}</span>
                        </button>
                        <button
                          aria-pressed={filter === "warnings"}
                          onClick={() => setFilter("warnings")}
                        >
                          <Warning size={13} />
                          Warnings<span>{warningCount}</span>
                        </button>
                      </div>
                      <div
                        className="optimization-findings"
                        key={`${material}-${report.totalMoves}-${report.optimizableSeconds}`}
                      >
                        {findings.map((finding) => (
                          <Finding
                            key={finding.id}
                            finding={finding}
                            onSeek={onSeek}
                            canSeek={canSeek}
                          />
                        ))}
                        {!findings.length && (
                          <p className="optimization-filter-empty">
                            {filter === "warnings"
                              ? "No warnings found."
                              : "No optimizations found."}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </>
              )
            )}
          </div>
          <footer className="optimization-footer">
            {report ? (
              <>
                <span>
                  {report.analyzedMoves.toLocaleString("en-US")} /{" "}
                  {report.totalMoves.toLocaleString("en-US")} segments
                </span>
                <strong>Finished</strong>
              </>
            ) : (
              <span>{pending ? "Analyzing locally" : "Local analysis"}</span>
            )}
          </footer>
        </aside>
      )}
    </div>
  );
}
