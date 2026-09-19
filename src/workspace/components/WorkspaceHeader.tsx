import { Check, DownloadSimple, Info } from "@phosphor-icons/react";
import okokokLogo from "../../assets/okokok-logo.svg";
interface Props {
  saved: boolean;
  save: () => void;
  onHelp: () => void;
}
export default function WorkspaceHeader({ saved, save, onHelp }: Props) {
  return (
    <header className="app-header">
      <a className="brand" href="/" aria-label="Forma home">
        <img
          className="brand-logo"
          src="/logo.svg"
          width="32"
          height="32"
          alt=""
        />
        <span>
          forma<span className="brand-period">.</span>
        </span>
      </a>
      <span className="header-divider">/</span>
      <div className="header-project header-attribution">
        <span>Community tool by</span>
        <a
          className="attribution-link okokok-link"
          href="https://okokok.design/"
          target="_blank"
          rel="noreferrer"
          aria-label="OKOKOK design"
        >
          <img className="okokok-logo" src={okokokLogo} alt="" />
        </a>
        <span className="attribution-separator" aria-hidden="true">
          -
        </span>
        <span>an</span>
        <a
          className="attribution-link anubi-link"
          href="https://anubi.io/"
          target="_blank"
          rel="noreferrer"
        >
          Anubi.io
        </a>
        <span>brand</span>
      </div>
      <div className="header-actions">
        <span className="local-label">
          <span />
          Everything stays on your device
        </span>
        <button className="button ghost" onClick={onHelp}>
          <Info size={16} />
          Help
        </button>
        <button className="button" onClick={save}>
          {saved ? <Check size={15} /> : <DownloadSimple size={15} />}
          <span>{saved ? "Project saved" : "Save project"}</span>
        </button>
      </div>
    </header>
  );
}
