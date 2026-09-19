import { useMemo, type CSSProperties } from "react";
import { STRIDE, type Program, type Assignments } from "../types";
import { groupToolChanges } from "../engine/playback";

type Props = {
  program?: Program;
  assignments: Assignments;
  fraction: number;
  disabled: boolean;
  onSeek: (fraction: number) => void;
};

export default function PlaybackTimeline({
  program,
  assignments,
  fraction,
  disabled,
  onSeek,
}: Props) {
  const count = program ? program.moves.length / STRIDE : 0;
  const groups = useMemo(
    () => groupToolChanges(program?.toolChanges ?? []),
    [program],
  );
  const seekAtPointer = (clientX: number, element: HTMLElement) => {
    if (disabled || !count) return;
    const rect = element.getBoundingClientRect();
    if (rect.width)
      onSeek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  };
  if (program?.operations)
    return (
      <div className="sequence-timeline">
        <div
          className="sequence-lanes"
          onPointerDown={(e) => {
            if (
              disabled ||
              !count ||
              !e.isPrimary ||
              e.button !== 0 ||
              (e.target as HTMLElement).closest(".operation-lane-label")
            )
              return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget
              .querySelector<HTMLElement>('[role="slider"]')
              ?.focus();
            seekAtPointer(e.clientX, e.currentTarget);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              seekAtPointer(e.clientX, e.currentTarget);
          }}
          onPointerUp={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            seekAtPointer(e.clientX, e.currentTarget);
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        >
          <div
            className="sequence-playhead"
            role="slider"
            tabIndex={disabled || !count ? -1 : 0}
            aria-label="Machining progress"
            aria-valuemin={0}
            aria-valuemax={count || 1}
            aria-valuenow={Math.round(fraction * count)}
            aria-valuetext={`${Math.round(fraction * 100)}%`}
            aria-disabled={disabled || !count}
            onKeyDown={(e) => {
              if (disabled || !count) return;
              const step = e.shiftKey ? 0.1 : 1 / count;
              const next = {
                ArrowLeft: fraction - step,
                ArrowDown: fraction - step,
                ArrowRight: fraction + step,
                ArrowUp: fraction + step,
                Home: 0,
                End: 1,
                PageDown: fraction - 0.1,
                PageUp: fraction + 0.1,
              }[e.key];
              if (next === undefined) return;
              e.preventDefault();
              onSeek(Math.max(0, Math.min(1, next)));
            }}
            style={{ left: `${fraction * 100}%` }}
          />
          {program.operations.map((op, index) => {
            const changes = groupToolChanges(
              program.toolChanges.slice(op.toolChangeStart, op.toolChangeEnd),
            );
            const active =
              Math.round(fraction * count) >= op.start &&
              (Math.round(fraction * count) < op.end ||
                index === program.operations!.length - 1);
            const progress = Math.max(
              0,
              Math.min(
                1,
                (fraction * count - op.start) / (op.end - op.start || 1),
              ),
            );
            return (
              <div
                key={op.side}
                className={`operation-lane ${op.side} ${active ? "active" : ""}`}
              >
                <button
                  className="operation-lane-label"
                  disabled={disabled}
                  onClick={() => onSeek(op.start / count)}
                  title={`Jump to ${op.side.toUpperCase()}`}
                >
                  {index + 1} · {op.side.toUpperCase()}
                </button>
                <div
                  className="operation-span"
                  style={{
                    left: `${(op.start / count) * 100}%`,
                    width: `${((op.end - op.start) / count) * 100}%`,
                  }}
                >
                  <span style={{ width: `${progress * 100}%` }} />
                </div>
                {changes.map((g, markerIndex) => (
                  <button
                    key={g.moveIndex}
                    className="operation-marker"
                    style={{ left: `${(g.moveIndex / count) * 100}%` }}
                    title={`${op.side.toUpperCase()} · ${g.changes.map((c) => `T${c.tool} · line ${c.line}`).join(" → ")}`}
                    aria-label={`Jump to ${op.side.toUpperCase()} tool change T${g.changes.at(-1)!.tool}`}
                    disabled={disabled}
                    onClick={(e) => {
                      if (e.detail === 0) onSeek(g.moveIndex / count);
                    }}
                  >
                    {markerIndex === changes.length - 1 ||
                    (changes[markerIndex + 1].moveIndex - g.moveIndex) / count >
                      0.04
                      ? `T${g.changes.at(-1)!.tool}`
                      : "·"}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  return (
    <div className="timeline-track">
      <input
        className="timeline"
        aria-label="Machining progress"
        type="range"
        min={0}
        max={count || 1}
        step={1}
        value={Math.round(fraction * count)}
        disabled={disabled || !count}
        onChange={(e) => onSeek(+e.target.value / count)}
        style={{ "--progress": `${fraction * 100}%` } as CSSProperties}
      />
      <div className="timeline-changes" aria-label="Timeline tool changes">
        {groups.map(({ moveIndex, changes }, index) => {
          const last = changes.at(-1)!;
          const label = changes
            .map(
              (change) =>
                `T${change.tool} · line ${change.line}${assignments[change.tool] ? ` · ${assignments[change.tool].name}` : ""}`,
            )
            .join(" → ");
          return (
            <button
              key={moveIndex}
              className={`timeline-change ${Math.round(fraction * count) >= moveIndex ? "reached" : ""}`}
              style={{ left: `${(moveIndex / count) * 100}%` }}
              title={`Tool change: ${label}`}
              aria-label={`Jump to tool change: ${label}`}
              disabled={disabled}
              onClick={() => onSeek(moveIndex / count)}
            >
              <span className="timeline-tick" />
              {(index === groups.length - 1 ||
                (groups[index + 1].moveIndex - moveIndex) / count > 0.07) && (
                <span className="timeline-tool-number">
                  T{last.tool}
                  {changes.length > 1 ? ` +${changes.length - 1}` : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
