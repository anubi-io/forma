import {
  Cylinder,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "@phosphor-icons/react";
import type {
  Assignments,
  BottomSetup,
  MachiningSide,
  Operation,
  Program,
  Surface,
} from "../../types";
import type { WorkspacePlayback } from "../useWorkspacePlayback";
import { operationAt } from "../../engine/sequence";
import IconButton from "../../components/IconButton";
import PlaybackTimeline from "../../components/PlaybackTimeline";
interface Props {
  program?: Program;
  surface?: Surface;
  assignments: Assignments;
  bottom?: BottomSetup;
  activeSide: MachiningSide;
  activeOperation?: Operation;
  blockingLoad: boolean;
  playbackDisabled: boolean;
  playback: WorkspacePlayback;
}
export default function PlaybackPanel({
  program,
  surface,
  assignments,
  bottom,
  activeSide,
  activeOperation,
  blockingLoad,
  playbackDisabled,
  playback,
}: Props) {
  const {
    fraction,
    playing,
    speed,
    setFraction,
    setPlaying,
    setSpeed,
    cursor,
    currentLine,
    count,
    toolChangeGroups,
    seek,
  } = playback;
  const actual = surface?.count ? surface.processed / surface.count : 0;
  const activeTool = cursor ? assignments[cursor.tool] : undefined;
  return (
    <div className="playback">
      <div className="playback-top">
        <div className="playback-title">
          <span>{bottom ? "TOP + BOTTOM" : "TOP simulation"}</span>
          <span className="badge">
            {blockingLoad ? "Preparing…" : `${Math.round(actual * 100)}%`}
          </span>
        </div>
        <span className="playback-line">
          {activeSide.toUpperCase()} · Line <b>{currentLine}</b> /{" "}
          {activeOperation?.lines ?? program?.lines ?? "…"}
        </span>
      </div>
      <div className="playback-controls">
        <IconButton
          label="Back to start"
          onClick={() => {
            setPlaying(false);
            setFraction(0);
          }}
          disabled={playbackDisabled}
        >
          <SkipBack size={17} weight="fill" />
        </IconButton>
        <button
          className="play-button"
          aria-label={playing ? "Pause" : "Play simulation"}
          disabled={playbackDisabled || !surface}
          onClick={() => {
            if (fraction >= 1) setFraction(0);
            setPlaying(!playing);
          }}
        >
          {playing ? (
            <Pause size={16} weight="fill" />
          ) : (
            <Play size={16} weight="fill" />
          )}
        </button>
        <IconButton
          label="Go to end"
          onClick={() => {
            setPlaying(false);
            setFraction(1);
          }}
          disabled={playbackDisabled}
        >
          <SkipForward size={17} weight="fill" />
        </IconButton>
        <PlaybackTimeline
          program={program}
          assignments={assignments}
          fraction={fraction}
          disabled={playbackDisabled}
          onSeek={seek}
        />
        <select
          aria-label="Playback speed"
          title="Relative to estimated machine motion time: programmed feed, rapids at 3000 mm/min; excludes acceleration, pauses and tool changes."
          value={speed}
          onChange={(e) => setSpeed(+e.target.value)}
        >
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={5}>5×</option>
          <option value={10}>10×</option>
        </select>
      </div>
      <div className="playback-tool">
        <span className="active-tool-label">
          <Cylinder size={14} />
          <strong>{cursor ? `T${cursor.tool}` : "—"}</strong>
          <span>
            {activeTool?.name ?? (cursor ? "Tool not assigned" : "No tool")}
          </span>
        </span>
        {!!program?.toolChanges.length && (
          <select
            aria-label="Jump to tool change"
            value={cursor?.changeIndex ?? -1}
            disabled={playbackDisabled}
            onChange={(e) => {
              const change = program.toolChanges[+e.target.value];
              if (change) seek(change.moveIndex / count);
            }}
          >
            <option value={-1} disabled>
              Tool changes
            </option>
            {toolChangeGroups.map((group) => (
              <option key={group.moveIndex} value={group.lastIndex}>
                {group.changes.map((change) => `T${change.tool}`).join(" → ")} ·{" "}
                {program.operations
                  ? operationAt(program, group.moveIndex)?.side.toUpperCase()
                  : "TOP"}{" "}
                · line {group.changes.at(-1)!.line}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
