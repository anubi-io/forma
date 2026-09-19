import { ArrowSquareOut } from "@phosphor-icons/react";
import Modal from "../../components/Modal";
interface Props {
  onClose: () => void;
}
export default function HelpDialog({ onClose }: Props) {
  return (
    <Modal title="From G-code to finished part" onClose={onClose}>
      <div className="help-content">
        <h3>1. Define the stock</h3>
        <p>
          Set dimensions in mm, material and XY/Z origins to match your CAM
          setup. Material textures are approximate.
        </p>
        <h3>2. Import and assign tools</h3>
        <p>
          Upload a file from Makera Studio, including compressed files, or
          another CAM application. Match each T number to a Makera or custom
          tool. The catalog does not automatically assign machine tool numbers.
        </p>
        <p>
          After importing G-code, choose its matching Makera Studio .mks to
          import stock dimensions and tools, or choose manual setup. Each new
          G-code starts a new setup. Origins remain editable in Stock; special
          or unverified tool profiles use toolpath-only mode.
        </p>
        <h3>3. Explore the machining process</h3>
        <p>
          Rotate the part, show the toolpath and scrub through the simulation.
          Click a T marker on the timeline to jump to a tool change. Quality
          controls grid resolution; arcs use a maximum chord error of 0.02 mm.
          Final detail depends on grid spacing.
        </p>
        <h3>Compatibility</h3>
        <p>
          Supports G0/G1, G2/G3 in G17/G18/G19 planes with I/J/K or R, G20/G21,
          G90/G91, G90.1/G91.1, G54–G59.3 work coordinate systems, T/M6
          automatic tool changes, and Carvera M220/M223 feed/RPM overrides. A
          single work system uses the stock origin. For multiple work zeros,
          enter their XYZ offsets relative to G54 under Stock → Work offsets.
          Carvera accessory commands are accepted. G28 clearance travel and G53
          rapids are excluded from toolpaths and timing; restore work
          coordinates with absolute rapid moves before cutting. X, Y and Z can
          be restored on separate lines. Unsupported codes stop the simulation
          and report the line number.
        </p>
        <p>
          Add a BOTTOM G-code to machine both faces in sequence. Choose the
          order and a 180° flip around the stock centre on X or Y. Stock origins
          are re-established on each face; T numbers share the same tool
          assignments. Both operations and their overlap are preserved through
          playback. Both faces use WebGPU when available. Thread mills with
          pitch, angle and neck dimensions also cut a local 3D volume on WebGPU,
          using an idealized single-form tooth. CPU mode shows their tool and
          path only. Other undercuts, turning, rotary axes, canned cycles,
          runtime offset changes with G10, probing, laser cutting and tool
          compensation are unsupported. Does not check collisions with fixtures
          or tool holders.
        </p>
        <h3>Local projects</h3>
        <p>
          Your workspace is saved automatically in this browser, including
          tools, stock, display settings and playback position. Refreshing
          restores it with playback paused. Clearing site data removes the local
          copy.
        </p>
        <p>
          “Save project” downloads stock, tools and G-code in a JSON file.
          Import it to resume your work. No program is sent to a server.
        </p>
        <div className="help-links">
          <a
            href="https://www.makera.com/collections/cnc-bits"
            target="_blank"
            rel="noreferrer"
          >
            Makera catalog <ArrowSquareOut size={14} />
          </a>
          <a
            href="https://github.com/MakeraInc/CarveraController"
            target="_blank"
            rel="noreferrer"
          >
            Makera controller <ArrowSquareOut size={14} />
          </a>
        </div>
      </div>
    </Modal>
  );
}
