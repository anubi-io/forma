import LoadingStatus from "./components/LoadingStatus";
import Workspace from "./workspace/Workspace";
import { useWorkspaceRestore } from "./workspace/useWorkspacePersistence";
export default function App() {
  const loaded = useWorkspaceRestore();
  if (!loaded)
    return (
      <div className="workspace-loading">
        <LoadingStatus
          title="Restoring workspace…"
          detail="Loading your saved project and view settings."
        />
      </div>
    );
  return <Workspace initial={loaded.snapshot} restoreError={loaded.error} />;
}
