// Shared by the file picker and worker so accepted files can be decoded.
export const PROGRAM_LIMIT_MB = 100;
// Room for two G-code sides plus JSON escaping and project metadata.
export const PROJECT_LIMIT_MB = 256;
export const PROGRAM_LIMIT_BYTES = PROGRAM_LIMIT_MB * 1024 * 1024;
export const PROJECT_LIMIT_BYTES = PROJECT_LIMIT_MB * 1024 * 1024;
