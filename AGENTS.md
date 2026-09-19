# Forma

- Use English for code, comments, and documentation.
- Preserve UI behavior, machining semantics, local-only file processing, and saved-project compatibility unless the task changes them.
- Keep `App.tsx` thin: `workspace/` coordinates state and workflows, `engine/` handles computation, `scene/` renders, and `components/` holds reusable UI. Extend existing modules before adding abstractions or dependencies.
- Read only what the task needs. Keep instructions concise and model-independent; avoid mandatory document tours and duplicated guidance.
- Finish implementation and relevant verification. Local tests use disposable fixtures; fix task-related failures and rerun affected checks autonomously. Commands are in `package.json`; contribution details are in `CONTRIBUTING.md` when needed.
- Put temporary docs, audits, scripts, screenshots, and reports in ignored `.local/`. Add permanent documentation only when requested.
