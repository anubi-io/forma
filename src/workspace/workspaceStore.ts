import { createWorkspaceStore } from "../workspaceStorage";
// One store coordinates restore and autosave for the lifetime of the app.
export const workspaceStore = createWorkspaceStore();
