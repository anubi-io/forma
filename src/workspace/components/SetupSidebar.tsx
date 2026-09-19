import type { ReactNode } from "react";
import {
  ArrowCounterClockwise,
  Cube,
  Cylinder,
  FileCode,
  Info,
} from "@phosphor-icons/react";
interface Props {
  tab: string;
  setTab: (tab: string) => void;
  missingCount: number;
  operations: ReactNode;
  children: ReactNode;
  loadDemo: () => void;
  onHelp: () => void;
}
export default function SetupSidebar({
  tab,
  setTab,
  missingCount,
  operations,
  children,
  loadDemo,
  onHelp,
}: Props) {
  return (
    <aside className="sidebar" id="machining-setup">
      <div className="sidebar-title">
        <h2>Machining setup</h2>
        <span className="badge">3 axes</span>
      </div>
      <div className="sidebar-tabs" role="tablist" aria-label="Configuration">
        <button
          role="tab"
          aria-selected={tab === "stock"}
          onClick={() => setTab("stock")}
        >
          <Cube size={15} />
          Stock
        </button>
        <button
          role="tab"
          aria-selected={tab === "tools"}
          onClick={() => setTab("tools")}
        >
          <Cylinder size={15} />
          Tools
          {missingCount > 0 && (
            <span className="tab-count">{missingCount}</span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={tab === "code"}
          onClick={() => setTab("code")}
        >
          <FileCode size={15} />
          G-code
        </button>
      </div>
      <div className="sidebar-content" role="tabpanel">
        {operations}
        {children}
      </div>
      <div className="sidebar-bottom">
        <button onClick={loadDemo}>
          <ArrowCounterClockwise size={14} />
          Reload example
        </button>
        <button aria-label="About the simulation" onClick={onHelp}>
          <Info size={16} />
        </button>
      </div>
    </aside>
  );
}
