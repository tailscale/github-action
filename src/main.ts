// Copyright (c) Lee Briggs, Tailscale Inc, & Contributors
// SPDX-License-Identifier: BSD-3-Clause

import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { spawn } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as semver from "semver";
import { setTimeout as wait } from "timers/promises";
import {
  ExecError,
  execCommand,
  getLogMode,
  logDebug,
  logInfo,
  withLogGroup,
} from "./logging";
import type { LogMode } from "./logging";

const cmdTailscale = "tailscale";
const cmdTailscaleFullPath = "/usr/local/bin/tailscale";
const cmdTailscaled = "tailscaled";
const cmdTailscaledFullPath = "/usr/local/bin/tailscaled";

const runnerLinux = "Linux";
const runnerWindows = "Windows";
const runnerMacOS = "macOS";

// XDG base directories with sensible defaults.
function xdgCacheDir(): string {
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
}

function xdgRuntimeDir(): string {
  return process.env.XDG_RUNTIME_DIR || xdgCacheDir();
}

const versionLatest = "latest";
const versionUnstable = "unstable";

interface TailscaleConfig {
  version: string;
  resolvedVersion: string;
  arch: string;
  authKey: string;
  oauthClientId: string;
  audience: string;
  oauthSecret: string;
  tags: string;
  hostname: string;
  args: string;
  tailscaledArgs: string;
  stateDir: string;
  timeout: string;
  retry: number;
  useCache: boolean;
  sha256Sum: string;
  pingHosts: string[];
  logMode: LogMode;
}

type tailnetInfo = {
  MagicDNSSuffix: string;
  MagicDNSEnabled: boolean;
};

type tailscaleStatus = {
  BackendState: string;
  CurrentTailnet: tailnetInfo;
};

// Cross-platform Tailscale local API status check
async function getTailscaleStatus(
  logMode: LogMode = "normal",
): Promise<tailscaleStatus> {
  const { stdout } = await execSilent(
    "get tailscale status",
    cmdTailscale,
    ["status", "--json"],
    { logMode },
  );
  return JSON.parse(stdout);
}

async function run(): Promise<void> {
  try {
    // Validate runner OS
    const runnerOS = process.env.RUNNER_OS || "";
    if (![runnerLinux, runnerWindows, runnerMacOS].includes(runnerOS)) {
      throw new Error("Support Linux, Windows, and macOS Only");
    }

    // Get and validate inputs
    const config = await getInputs();

    if (
      runnerOS === runnerMacOS &&
      config.version === versionUnstable &&
      config.useCache
    ) {
      throw new Error(
        "Caching of unstable releases is not supported on macOS runners",
      );
    }

    // Validate authentication
    validateAuth(config);

    await withLogGroup(
      config.logMode,
      "Resolving Tailscale version",
      async () => {
        config.resolvedVersion = await resolveVersion(
          config.version,
          runnerOS,
          config.logMode,
        );
        logInfo(
          config.logMode,
          `Resolved Tailscale version: ${config.resolvedVersion}`,
        );
      },
    );

    // Set architecture
    config.arch = getTailscaleArch(runnerOS);

    await withLogGroup(config.logMode, "Installing Tailscale", async () => {
      await installTailscale(config, runnerOS);
    });

    if (runnerOS !== runnerWindows) {
      await withLogGroup(config.logMode, "Starting tailscaled", async () => {
        await startTailscaleDaemon(config);
      });
    }

    await withLogGroup(config.logMode, "Connecting to Tailscale", async () => {
      await connectToTailscale(config, runnerOS);
    });

    let shouldPingHosts = false;
    await withLogGroup(
      config.logMode,
      "Checking Tailscale status",
      async () => {
        try {
          const status = await getTailscaleStatus(config.logMode);
          if (status.BackendState === "Running") {
            logInfo(config.logMode, "✅ Tailscale is running and connected!");
            if (runnerOS === runnerMacOS) {
              await configureDNSOnMacOS(status, config.logMode);
            }
            shouldPingHosts = true;
          } else {
            core.setFailed(
              `❌ Tailscale backend state: ${status.BackendState}`,
            );
            process.exitCode = 1;
          }
        } catch (err) {
          core.warning(`Failed to get Tailscale status: ${err}`);
          if (runnerOS === runnerMacOS) {
            core.setFailed(
              `❌ Tailscale status is required in order to configure macOS`,
            );
            process.exitCode = 2;
            return;
          }
          // Still exit successfully since the main connection worked
          logInfo(config.logMode, "✅ Tailscale daemon is connected!");
          shouldPingHosts = true;
        }
      },
    );

    if (shouldPingHosts) {
      await pingHostsIfNecessary(config);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

async function pingHostsIfNecessary(config: TailscaleConfig): Promise<void> {
  if (config.pingHosts.length == 0) {
    return;
  }

  await withLogGroup(config.logMode, "Pinging Tailscale hosts", async () => {
    logInfo(
      config.logMode,
      `Will ping hosts ${config.pingHosts.join(
        ",",
      )} up to 3 minutes each (in parallel) in order to check connectivity`,
    );
    let pings = config.pingHosts.map((host) => pingHost(host, config.logMode));
    for (const ping of pings) {
      await ping;
    }
  });
}

async function pingHost(host: string, logMode: LogMode): Promise<void> {
  logInfo(logMode, `Pinging host ${host}`);
  let start = new Date().getTime();
  var i = 0;
  // Try for up to 180 seconds (3 minutes).
  while ((new Date().getTime() - start) / 1000 < 180) {
    if (i > 0) {
      // Exponential backoff on wait time, with maximum 5 second wait.
      let waitTime = Math.min(Math.pow(1.3, i), 5000);
      logDebug(logMode, `Waiting ${waitTime} milliseconds before pinging`);
      await wait(waitTime);
    }
    try {
      await execSilent("ping host", cmdTailscale, ["ping", "-c", "1", host], {
        logMode,
      });
      logInfo(logMode, `✅ Ping host ${host} reachable via direct connection!`);
      return;
    } catch (err) {
      if (
        err instanceof ExecError &&
        err.stderr.includes("direct connection not established")
      ) {
        // Relayed connectivity is good enough, we don't want to tie up a CI job waiting for a direct connection.
        logInfo(logMode, `✅ Ping host ${host} reachable via DERP!`);
        return;
      }
    }
    i++;
  }
  throw new Error(`❌ Ping host ${host} did not respond`);
}

async function getInputs(): Promise<TailscaleConfig> {
  let ping = core.getInput("ping");
  let pingHosts = ping?.length > 0 ? ping.split(",") : [];
  const logMode = getLogMode();

  const authKey = core.getInput("authkey") || "";
  const oauthSecret = core.getInput("oauth-secret") || "";

  // Mask sensitive values in logs unless debug mode is enabled
  if (!core.isDebug()) {
    if (authKey) {
      core.setSecret(authKey);
    }
    if (oauthSecret) {
      core.setSecret(oauthSecret);
    }
  }

  const config = {
    version: core.getInput("version") || "1.94.2",
    resolvedVersion: "",
    arch: "",
    authKey: authKey,
    oauthClientId: core.getInput("oauth-client-id") || "",
    audience: core.getInput("audience") || "",
    oauthSecret: oauthSecret,
    tags: core.getInput("tags") || "",
    hostname: core.getInput("hostname") || "",
    args: core.getInput("args") || "",
    tailscaledArgs: core.getInput("tailscaled-args") || "",
    stateDir: core.getInput("statedir") || "",
    timeout: core.getInput("timeout") || "60s", // Reduced from 2m to 60s
    retry: parseInt(core.getInput("retry") || "5"),
    useCache: core.getBooleanInput("use-cache"),
    sha256Sum: core.getInput("sha256sum") || "",
    pingHosts: pingHosts,
    logMode: logMode,
  };

  if (config.oauthSecret && !config.tags) {
    throw new Error(
      "the tags parameter is required when using an OAuth client",
    );
  }

  return config;
}

function validateAuth(config: TailscaleConfig): void {
  if (
    !config.authKey &&
    (!config.oauthSecret || !config.tags) &&
    (!config.audience || !config.oauthClientId || !config.tags)
  ) {
    throw new Error(
      "Please provide either an auth key, OAuth secret and tags, or federated identity client ID and audience with tags.",
    );
  }

  if (
    config.audience &&
    semver.valid(config.version) &&
    semver.gt("1.90.0", config.version)
  ) {
    throw new Error(
      "Workload identity federation requires using tailscale version 1.90.0 or later.",
    );
  }
}

async function resolveVersion(
  version: string,
  runnerOS: string,
  logMode: LogMode,
): Promise<string> {
  if (runnerOS === runnerMacOS && version === versionUnstable) {
    return "main";
  }

  if (version === versionLatest || version === versionUnstable) {
    let path = version === versionUnstable ? versionUnstable : "stable";
    let pkg = `https://pkgs.tailscale.com/${path}/?mode=json`;
    const { stdout } = await execSilent(
      `curl ${pkg}`,
      "curl",
      ["-H", "user-agent:action-setup-tailscale", "-s", pkg],
      { logMode },
    );
    const response = JSON.parse(stdout);
    switch (runnerOS) {
      case runnerLinux:
        return response.TarballsVersion;
      case runnerMacOS:
        // Use latest tag on macOS since we are building from source
        return response.Version;
      case runnerWindows:
        return response.MSIsVersion;
      default:
        return response.Version;
    }
  }

  return version;
}

function getTailscaleArch(runnerOS: string): string {
  const runnerArch = process.env.RUNNER_ARCH || "";

  if (runnerOS === runnerLinux) {
    switch (runnerArch) {
      case "ARM64":
        return "arm64";
      case "ARM":
        return "arm";
      case "X86":
        return "386";
      case "riscv64":
        return "riscv64";
      default:
        return "amd64";
    }
  } else if (runnerOS === runnerWindows) {
    switch (runnerArch) {
      case "ARM64":
        return "arm64";
      case "X86":
        return "x86";
      default:
        return "amd64";
    }
  } else if (runnerOS === runnerMacOS) {
    switch (runnerArch) {
      case "ARM64":
        return "arm64";
      default:
        return "amd64";
    }
  }
  return "amd64";
}

async function installTailscale(
  config: TailscaleConfig,
  runnerOS: string,
): Promise<void> {
  const cacheKey = generateCacheKey(config, runnerOS);
  const toolPath = getToolPath(config, runnerOS);

  // Try to restore from cache first
  if (config.useCache && cacheKey) {
    const cacheHit = await cache.restoreCache([toolPath], cacheKey);
    if (cacheHit) {
      logInfo(
        config.logMode,
        `Found Tailscale ${config.resolvedVersion} in cache: ${toolPath}`,
      );

      // For Windows, install the cached MSI
      if (runnerOS === runnerWindows) {
        await installTailscaleWindows(config, toolPath, true);
      } else {
        // For Linux/macOS, copy binaries to /usr/local/bin
        await installCachedBinaries(config, toolPath, runnerOS);
      }
      return;
    }
  }

  // Install fresh if not cached
  if (runnerOS === runnerLinux) {
    await installTailscaleLinux(config, toolPath);
  } else if (runnerOS === runnerWindows) {
    await installTailscaleWindows(config, toolPath);
  } else if (runnerOS === runnerMacOS) {
    await installTailscaleMacOS(config, toolPath);
  }

  // Save to cache after installation
  if (config.useCache && cacheKey) {
    try {
      await cache.saveCache([toolPath], cacheKey);
      logInfo(
        config.logMode,
        `Cached Tailscale ${config.resolvedVersion} at: ${toolPath}`,
      );
    } catch (error) {
      const typedError = error as Error;
      if (typedError.name === cache.ValidationError.name) {
        throw error;
      } else if (typedError.name === cache.ReserveCacheError.name) {
        logInfo(config.logMode, typedError.message);
      } else {
        core.warning(`Cache save failed: ${typedError.message}`);
      }
    }
  }
}

async function calculateFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => reject(err));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex").toLowerCase()));
  });
}

async function installTailscaleLinux(
  config: TailscaleConfig,
  toolPath: string,
): Promise<void> {
  // Determine if stable or unstable
  const minor = parseInt(config.resolvedVersion.split(".")[1]);
  const isStable = minor % 2 === 0;
  const baseUrl = isStable
    ? "https://pkgs.tailscale.com/stable"
    : "https://pkgs.tailscale.com/unstable";

  // Get SHA256 if not provided
  if (!config.sha256Sum) {
    const shaUrl = `${baseUrl}/tailscale_${config.resolvedVersion}_${config.arch}.tgz.sha256`;
    const { stdout } = await execSilent(
      `curl ${shaUrl}`,
      "curl",
      ["-H", "user-agent:action-setup-tailscale", "-L", shaUrl, "--fail"],
      { logMode: config.logMode },
    );
    config.sha256Sum = stdout.trim();
  }

  // Download and extract
  const downloadUrl = `${baseUrl}/tailscale_${config.resolvedVersion}_${config.arch}.tgz`;
  const expectedSha = config.sha256Sum.trim().toLowerCase();

  const tarDest = path.join(xdgCacheDir(), "tailscale.tgz");
  fs.mkdirSync(path.dirname(tarDest), { recursive: true });

  // Check if the tarball already exists with the correct checksum (for
  // persistent self-hosted runners). tc.downloadTool refuses to overwrite an
  // existing destination, so a tarball leaked by a previous job would
  // otherwise fail with "Destination file path already exists" whenever the
  // GitHub Actions cache backend doesn't return a hit.
  let tarPath = tarDest;
  let needsDownload = true;
  if (fs.existsSync(tarDest)) {
    const existingSha = await calculateFileSha256(tarDest);
    if (existingSha === expectedSha) {
      logInfo(
        config.logMode,
        `Using existing tarball at ${tarDest} (checksum verified)`,
      );
      needsDownload = false;
    } else {
      logInfo(
        config.logMode,
        `Existing tarball checksum mismatch, re-downloading`,
      );
      fs.unlinkSync(tarDest);
    }
  }

  if (needsDownload) {
    logInfo(config.logMode, `Downloading ${downloadUrl}`);
    tarPath = await tc.downloadTool(downloadUrl, tarDest);

    // Verify checksum
    const actualSha = await calculateFileSha256(tarPath);
    logInfo(config.logMode, `Expected sha256: ${expectedSha}`);
    logInfo(config.logMode, `Actual sha256: ${actualSha}`);
    if (actualSha !== expectedSha) {
      throw new Error("SHA256 checksum mismatch");
    }
  }

  // Extract to tool path
  const extractedPath = await tc.extractTar(tarPath, undefined, "xz");
  const extractedDir = path.join(
    extractedPath,
    `tailscale_${config.resolvedVersion}_${config.arch}`,
  );

  // Create tool directory and copy binaries there for caching
  fs.mkdirSync(toolPath, { recursive: true });
  fs.copyFileSync(
    path.join(extractedDir, cmdTailscale),
    path.join(toolPath, cmdTailscale),
  );
  fs.copyFileSync(
    path.join(extractedDir, cmdTailscaled),
    path.join(toolPath, cmdTailscaled),
  );

  // Install binaries to /usr/local/bin
  await execSilent(
    "copy tailscale binaries to /usr/local/bin",
    "sudo",
    [
      "cp",
      path.join(toolPath, cmdTailscale),
      path.join(toolPath, cmdTailscaled),
      "/usr/local/bin",
    ],
    { logMode: config.logMode },
  );

  // Make sure they're executable
  await execSilent(
    "chmod tailscale binary",
    "sudo",
    ["chmod", "+x", cmdTailscaleFullPath],
    { logMode: config.logMode },
  );
  await execSilent(
    "chmod tailscaled binary",
    "sudo",
    ["chmod", "+x", cmdTailscaledFullPath],
    { logMode: config.logMode },
  );
}

async function installTailscaleWindows(
  config: TailscaleConfig,
  toolPath: string,
  fromCache: boolean = false,
): Promise<void> {
  // Create tool directory
  fs.mkdirSync(toolPath, { recursive: true });
  const msiPath = path.join(toolPath, "tailscale.msi");

  if (fromCache) {
    // Installing from cached MSI
    if (!fs.existsSync(msiPath)) {
      throw new Error(`Cached MSI not found at ${msiPath}`);
    }
    logInfo(config.logMode, `Installing cached MSI from ${msiPath}`);
  } else {
    // Fresh download
    // Determine if stable or unstable
    const minor = parseInt(config.resolvedVersion.split(".")[1]);
    const isStable = minor % 2 === 0;
    const baseUrl = isStable
      ? "https://pkgs.tailscale.com/stable"
      : "https://pkgs.tailscale.com/unstable";

    // Get SHA256 if not provided
    if (!config.sha256Sum) {
      const shaUrl = `${baseUrl}/tailscale-setup-${config.resolvedVersion}-${config.arch}.msi.sha256`;
      const { stdout } = await execSilent(
        `curl ${shaUrl}`,
        "curl",
        ["-H", "user-agent:action-setup-tailscale", "-L", shaUrl, "--fail"],
        { logMode: config.logMode },
      );
      config.sha256Sum = stdout.trim();
    }

    // Download MSI
    const downloadUrl = `${baseUrl}/tailscale-setup-${config.resolvedVersion}-${config.arch}.msi`;
    const expectedSha = config.sha256Sum.trim().toLowerCase();

    // Check if MSI already exists with correct checksum (for self-hosted runners)
    let needsDownload = true;
    if (fs.existsSync(msiPath)) {
      const existingSha = await calculateFileSha256(msiPath);
      if (existingSha === expectedSha) {
        logInfo(
          config.logMode,
          `Using existing MSI at ${msiPath} (checksum verified)`,
        );
        needsDownload = false;
      } else {
        logInfo(
          config.logMode,
          `Existing MSI checksum mismatch, re-downloading`,
        );
        fs.unlinkSync(msiPath);
      }
    }

    if (needsDownload) {
      logInfo(config.logMode, `Downloading ${downloadUrl}`);
      const downloadedMsiPath = await tc.downloadTool(downloadUrl, msiPath);

      // Verify checksum
      const actualSha = await calculateFileSha256(downloadedMsiPath);
      logInfo(config.logMode, `Expected sha256: ${expectedSha}`);
      logInfo(config.logMode, `Actual sha256: ${actualSha}`);
      if (actualSha !== expectedSha) {
        throw new Error("SHA256 checksum mismatch");
      }

      // Keep the MSI file in toolPath for caching (don't delete it)
      // The downloadedMsiPath is in temp, but we want to keep it in toolPath
      if (downloadedMsiPath !== msiPath) {
        fs.copyFileSync(downloadedMsiPath, msiPath);
      }
    }
  }

  // Install MSI (same for both fresh and cached)
  await execSilent(
    "install msi",
    "msiexec.exe",
    [
      "/quiet",
      `/l*v`,
      path.join(process.env.RUNNER_TEMP || "", "tailscale.log"),
      "/i",
      msiPath,
    ],
    { logMode: config.logMode },
  );

  // Add to PATH
  core.addPath("C:\\Program Files\\Tailscale\\");
}

async function installTailscaleMacOS(
  config: TailscaleConfig,
  toolPath: string,
): Promise<void> {
  logInfo(config.logMode, "Building tailscale from src on macOS...");

  // Clone the repo
  await execSilent(
    "clone tailscale repo",
    "git clone https://github.com/tailscale/tailscale.git tailscale",
    [],
    { logMode: config.logMode },
  );

  // Checkout the resolved version
  await execSilent(
    "checkout resolved version",
    `git checkout v${config.resolvedVersion}`,
    [],
    {
      cwd: cmdTailscale,
      logMode: config.logMode,
    },
  );

  // Create tool directory and copy binaries there for caching
  fs.mkdirSync(toolPath, { recursive: true });

  // Build tailscale and tailscaled into tool directory
  for (const binary of [cmdTailscale, cmdTailscaled]) {
    await execSilent(
      `build ${binary}`,
      `./build_dist.sh -o ${path.join(toolPath, binary)} ./cmd/${binary}`,
      [],
      {
        cwd: cmdTailscale,
        env: {
          ...process.env,
          TS_USE_TOOLCHAIN: "1",
          GOWORK: "off",
        },
        logMode: config.logMode,
      },
    );
  }

  // Install binaries to /usr/local/bin
  await execSilent(
    "copy binaries to /usr/local/bin",
    "sudo",
    [
      "cp",
      path.join(toolPath, cmdTailscale),
      path.join(toolPath, cmdTailscaled),
      "/usr/local/bin",
    ],
    { logMode: config.logMode },
  );

  // Make sure they're executable
  await execSilent(
    "chmod tailscale",
    "sudo",
    ["chmod", "+x", cmdTailscaleFullPath],
    { logMode: config.logMode },
  );
  await execSilent(
    "chmod tailscaled",
    "sudo",
    ["chmod", "+x", cmdTailscaledFullPath],
    { logMode: config.logMode },
  );

  logInfo(
    config.logMode,
    "✅ Tailscale installed successfully on macOS from source",
  );
}

async function startTailscaleDaemon(config: TailscaleConfig): Promise<void> {
  const runnerOS = process.env.RUNNER_OS || "";

  // Manual daemon start
  const stateArgs = config.stateDir
    ? [`--statedir=${config.stateDir}`]
    : ["--state=mem:"];

  if (config.stateDir) {
    fs.mkdirSync(config.stateDir, { recursive: true });
  }

  const args = [
    ...stateArgs,
    ...config.tailscaledArgs.split(" ").filter(Boolean),
  ];

  logInfo(config.logMode, "Starting tailscaled daemon...");

  // Start daemon in background
  const daemon = spawn("sudo", ["-E", cmdTailscaled, ...args], {
    detached: true,
    stdio: [
      "ignore",
      "ignore",
      fs.openSync(path.join(os.homedir(), "tailscaled.log"), "w"),
    ],
  });

  // Store PID for cleaning up daemon process in logout.ts.
  const pidFile = path.join(xdgRuntimeDir(), "tailscaled.pid");
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${daemon.pid}`);

  daemon.unref(); // Ensure daemon doesn't keep Node.js process alive

  // Close stdin/stdout/stderr to fully detach
  if (daemon.stdin) daemon.stdin.end();
  if (daemon.stdout) daemon.stdout.destroy();
  if (daemon.stderr) daemon.stderr.destroy();

  // Poll the local API until daemon is responsive
  await waitForDaemonReady(config.logMode);

  logInfo(config.logMode, "✅ tailscaled daemon is up and running!");
}

async function waitForDaemonReady(logMode: LogMode): Promise<void> {
  const maxWaitMs = 15000; // 15 seconds
  const pollIntervalMs = 500;
  let waited = 0;

  logInfo(logMode, "Waiting for tailscaled daemon to become ready...");

  var lastErr: any;
  while (waited < maxWaitMs) {
    try {
      const status = await getTailscaleStatus(logMode);
      // If we get any valid response from the API, the daemon is ready
      if (status) {
        logInfo(
          logMode,
          `Daemon ready! Initial state: ${status.BackendState || "Unknown"}`,
        );
        return;
      }
    } catch (err) {
      // Daemon not ready yet, keep polling
      lastErr = err;
      logDebug(logMode, `Waiting for daemon... (${waited}ms elapsed)`);
    }
    await sleep(pollIntervalMs);
    waited += pollIntervalMs;
  }

  throw new Error(
    `tailscaled daemon did not become ready within timeout, last error: ${lastErr}`,
  );
}

async function connectToTailscale(
  config: TailscaleConfig,
  runnerOS: string,
): Promise<void> {
  // Determine hostname
  let hostname = config.hostname;
  if (!hostname) {
    if (runnerOS === runnerWindows) {
      hostname = `github-${process.env.COMPUTERNAME}`;
    } else {
      const { stdout } = await execSilent("hostname", "hostname", [], {
        logMode: config.logMode,
      });
      hostname = `github-${stdout.trim()}`;
    }
  }

  // Limit hostname to 63 characters (more will result in the error "not a valid DNS label")
  hostname = hostname.substring(0, 63);

  // Prepare auth and tags.
  //
  // Items higher in this list take precedence for auth:
  // 1. Workload identity
  // 2. OAuth client
  // 3. Auth key
  let authArgs: string[];
  let tagsArg: string[] = [];

  authArgs = [`--authkey=${config.authKey}`];

  if (config.audience || config.oauthSecret) {
    tagsArg = [`--advertise-tags=${config.tags}`];

    if (config.audience) {
      const token = await core.getIDToken(config.audience);
      authArgs = [
        `--client-id=${config.oauthClientId}?preauthorized=true&ephemeral=true`,
        `--id-token=${token}`,
      ];
    } else if (config.oauthSecret) {
      authArgs = [
        `--authkey=${config.oauthSecret}?preauthorized=true&ephemeral=true`,
      ];
    }
  }
  // Platform-specific args
  const platformArgs: string[] = [];
  if (runnerOS === runnerWindows) {
    platformArgs.push("--unattended");
  }

  // Build command
  const upArgs = [
    "up",
    ...tagsArg,
    `--hostname=${hostname}`,
    "--accept-routes",
    ...platformArgs,
    ...config.args.split(" ").filter(Boolean),
    ...authArgs,
  ];

  // Retry logic
  for (let attempt = 1; attempt <= config.retry; attempt++) {
    try {
      logInfo(config.logMode, `Attempt ${attempt} to bring up Tailscale...`);

      let execArgs: string[];
      if (runnerOS === runnerWindows) {
        execArgs = [cmdTailscale, ...upArgs];
      } else {
        // Linux and macOS - use system-installed binary with sudo
        execArgs = ["sudo", "-E", cmdTailscale, ...upArgs];
      }

      const timeoutMs = parseTimeout(config.timeout);
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          execSilent("tailscale up", execArgs[0], execArgs.slice(1), {
            logMode: config.logMode,
          }),
          new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error("Timeout")),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }

      // Success
      logInfo(
        config.logMode,
        `✅ Tailscale up command completed successfully on attempt ${attempt}`,
      );
      return;
    } catch (error) {
      core.warning(`Tailscale up attempt ${attempt} failed: ${error}`);
      if (attempt === config.retry) {
        throw error;
      }

      const sleepTime = attempt * 2; // Reduced from 5 to 2 seconds
      logInfo(config.logMode, `Retrying in ${sleepTime} seconds...`);
      await sleep(sleepTime * 1000);
    }
  }
}

function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+)([smh]?)$/);
  if (!match) return 120000; // default 2 minutes

  const value = parseInt(match[1]);
  const unit = match[2] || "s";

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      return value * 1000;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateCacheKey(
  config: TailscaleConfig,
  runnerOS: string,
): string | undefined {
  if (!config.useCache) {
    return undefined;
  }

  return `action-setup-tailscale/${config.resolvedVersion}/${runnerOS}-${config.arch}`;
}

function getToolPath(config: TailscaleConfig, runnerOS: string): string {
  const cacheDirectory = process.env.RUNNER_TOOL_CACHE || "";
  if (cacheDirectory === "") {
    core.warning("Expected RUNNER_TOOL_CACHE to be defined");
  }

  return path.join(
    cacheDirectory,
    cmdTailscale,
    config.resolvedVersion,
    `${runnerOS}-${config.arch}`,
  );
}

async function installCachedBinaries(
  config: TailscaleConfig,
  toolPath: string,
  runnerOS: string,
): Promise<void> {
  if (runnerOS === runnerLinux || runnerOS === runnerMacOS) {
    // Copy cached binaries to /usr/local/bin
    const tailscaleBin = path.join(toolPath, cmdTailscale);
    const tailscaledBin = path.join(toolPath, cmdTailscaled);

    if (fs.existsSync(tailscaleBin) && fs.existsSync(tailscaledBin)) {
      await execSilent(
        "copy tailscale from cache",
        "sudo",
        ["cp", tailscaleBin, cmdTailscaleFullPath],
        { logMode: config.logMode },
      );
      await execSilent(
        "copy tailscaled from cache",
        "sudo",
        ["cp", tailscaledBin, cmdTailscaledFullPath],
        { logMode: config.logMode },
      );
      await execSilent(
        "chmod tailscale",
        "sudo",
        ["chmod", "+x", cmdTailscaleFullPath],
        { logMode: config.logMode },
      );
      await execSilent(
        "chmod tailscaled",
        "sudo",
        ["chmod", "+x", cmdTailscaledFullPath],
        { logMode: config.logMode },
      );
    } else {
      throw new Error(`Cached binaries not found in ${toolPath}`);
    }
  }
}

async function configureDNSOnMacOS(
  status: tailscaleStatus,
  logMode: LogMode,
): Promise<void> {
  if (!status.CurrentTailnet.MagicDNSEnabled) {
    logInfo(logMode, "MagicDNS is disabled, not configuring DNS");
    return;
  }

  logInfo(
    logMode,
    `Setting system DNS server to 100.100.100.100 and searchdomains to ${status.CurrentTailnet.MagicDNSSuffix}`,
  );
  try {
    await execSilent(
      "set dns servers",
      "networksetup",
      ["-setdnsservers", "Ethernet", "100.100.100.100"],
      { logMode },
    );
    await execSilent(
      "set search domains",
      "networksetup",
      ["-setsearchdomains", "Ethernet", status.CurrentTailnet.MagicDNSSuffix],
      { logMode },
    );
  } catch (e) {
    throw Error(`Failed to configure DNS on macOS: ${e}`);
  }
}

run();

/**
 * Executes the given command, logging the given label as info, but suppressing
 * all other output including the command line itself (unless debug logging is enabled,
 * see https://docs.github.com/en/actions/how-tos/monitor-workflows/enable-debug-logging).
 *
 * If the command fails, stderr is written to the console.
 *
 * @param label a label to use for info logging what's happening
 * @param cmd the command to run
 * @param args arguments to the command
 * @returns stdout (if command was successful)
 * @throws execError if exec returned a non-zero status code
 */
async function execSilent(
  label: string,
  cmd: string,
  args?: string[],
  opts?: exec.ExecOptions & { logMode?: LogMode },
): Promise<exec.ExecOutput> {
  return execCommand(cmd, args, {
    ...opts,
    label,
  });
}
