export interface ActionInputs {
  authkey: string;
  oauthClientId: string;
  oauthSecret: string;
  tags: string;
  version: string;
  sha256sum: string;
  args: string;
  tailscaledArgs: string;
  hostname: string;
  statedir: string;
  timeout: string;
  retry: string;
  useCache: string;
}

export interface TailscaleVersion {
  Version: string;
}

export interface OSInfo {
  platform: string;
  arch: string;
  isWindows: boolean;
  isLinux: boolean;
  isMacOS: boolean;
}

export interface TailscaleArchInfo {
  arch: string;
  resolvedVersion: string;
}

export interface DownloadInfo {
  url: string;
  filename: string;
  sha256: string;
}

export interface InstallPaths {
  tailscale: string;
  tailscaled: string;
}

export interface ConnectionConfig {
  authkey: string;
  hostname: string;
  tags?: string;
  additionalArgs: string;
  timeout: string;
  retry: number;
  platformSpecificArgs: string;
}

export interface CacheInfo {
  enabled: boolean;
  key: string;
  paths: string[];
  hit?: boolean;
}

export enum RunnerOS {
  Linux = 'Linux',
  Windows = 'Windows',
  macOS = 'macOS'
}

export enum RunnerArch {
  X64 = 'X64',
  ARM64 = 'ARM64',
  ARM = 'ARM',
  X86 = 'X86'
}