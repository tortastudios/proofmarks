export class ConfigError extends Error {}
export type ConfigDocument = { id: string; url?: string; format: 'markdown' | 'mdx' | 'html' | 'jinja'; source: string; review: string; write: boolean; sourcePath: string; reviewPath: string; logPath: string };
export type ProofmarksConfig = { version: 1; rebuild?: string; devServer?: string; origins: string[]; tailnetHosts: string[]; tailscaleUsers: string[]; projectRoot: string; roots: string[]; rules?: Record<string, boolean>; judge: { provider: 'jev' | 'fake'; model: string }; documents: ConfigDocument[] };
export function loadConfig(projectRoot: string): Promise<ProofmarksConfig>;
