import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as tc from "@actions/tool-cache";
import { spawn } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

const cmdTailscale = "tailscale";
const cmdTailscaleFullPath = "/usr/local/bin/tailscale";
const cmdTailscaled = "tailscaled";
const cmdTailscaledFullPath = "/usr/local/bin/tailscaled";

const platformWin32 = "win32";
const platformDarwin = "darwin";

const runnerLinux = "Linux";
const runnerWindows = "Windows";
const runnerMacOS = "macOS";

const versionLatest = "latest";
const versionUnstable = "unstable";

interface TailscaleConfig {
  version: string;
  resolvedVersion: string;
  arch: string;
  authKey: string;
  oauthClientId: string;
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
}

// Cross-platform Tailscale local API status check
async function getTailscaleStatus(): Promise<any> {
  const platform = os.platform();

  if (platform === platformWin32) {
    // Windows: use tailscale status command
    const { stdout } = await exec.getExecOutput(cmdTailscale, [
      "status",
      "--json",
    ]);
    return JSON.parse(stdout);
  } else if (platform === platformDarwin) {
    // macOS: use /var/run/tailscaled.socket
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: "/var/run/tailscaled.socket",
        path: "/localapi/v0/status",
        method: "GET",
        headers: { Host: "local-tailscaled.sock" },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });

      // Set timeout to prevent hanging
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      req.on("error", reject);
      req.end();
    });
  } else {
    // Linux: use Unix socket
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: "/run/tailscale/tailscaled.sock",
        path: "/localapi/v0/status",
        method: "GET",
        headers: { Host: "local-tailscaled.sock" },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });

      // Set timeout to prevent hanging
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });

      req.on("error", reject);
      req.end();
    });
  }
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
        "Caching of unstable releases is not supported on macOS runners"
      );
    }

    // Validate authentication
    validateAuth(config);

    // Resolve version
    config.resolvedVersion = await resolveVersion(config.version, runnerOS);
    core.info(`Resolved Tailscale version: ${config.resolvedVersion}`);

    // Set architecture
    config.arch = getTailscaleArch(runnerOS);

    // Install Tailscale
    await installTailscale(config, runnerOS);

    // Start daemon (non-Windows only)
    if (runnerOS !== runnerWindows) {
      await startTailscaleDaemon(config);
    }

    // Connect to Tailscale
    await connectToTailscale(config, runnerOS);

    // Check Tailscale status (cross-platform)
    try {
      const status = await getTailscaleStatus();
      core.debug(`Tailscale status: ${JSON.stringify(status)}`);
      if (status.BackendState === "Running") {
        core.info("✅ Tailscale is running and connected!");
        // Explicitly exit to prevent hanging
        process.exit(0);
      } else {
        core.setFailed(`❌ Tailscale backend state: ${status.BackendState}`);
        process.exit(1);
      }
    } catch (err) {
      core.warning(`Failed to get Tailscale status: ${err}`);
      // Still exit successfully since the main connection worked
      core.info("✅ Tailscale connection completed successfully!");
      process.exit(0);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

async function getInputs(): Promise<TailscaleConfig> {
  return {
    version: core.getInput("version") || "1.82.0",
    resolvedVersion: "",
    arch: "",
    authKey: core.getInput("authkey") || "",
    oauthClientId: core.getInput("oauth-client-id") || "",
    oauthSecret: core.getInput("oauth-client-secret") || "",
    tags: core.getInput("tags") || "",
    hostname: core.getInput("hostname") || "",
    args: core.getInput("args") || "",
    tailscaledArgs: core.getInput("tailscaled-args") || "",
    stateDir: core.getInput("statedir") || "",
    timeout: core.getInput("timeout") || "60s", // Reduced from 2m to 60s
    retry: parseInt(core.getInput("retry") || "5"),
    useCache: core.getBooleanInput("use-cache"),
    sha256Sum: core.getInput("sha256sum") || "",
  };
}

function validateAuth(config: TailscaleConfig): void {
  if (!config.authKey && (!config.oauthSecret || !config.tags)) {
    throw new Error(
      "OAuth identity empty, please provide either an auth key or OAuth secret and tags."
    );
  }
}

async function resolveVersion(
  version: string,
  runnerOS: string
): Promise<string> {
  if (runnerOS === runnerMacOS && version === versionUnstable) {
    return "main";
  }

  if (version === versionLatest || version === versionUnstable) {
    let path = version === versionUnstable ? versionUnstable : "stable";
    const { stdout } = await exec.getExecOutput("curl", [
      "-H",
      "user-agent:action-setup-tailscale",
      "-s",
      `https://pkgs.tailscale.com/${path}/?mode=json`,
    ]);
    const response = JSON.parse(stdout);
    return response.Version;
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
  }
  return "amd64";
}

async function installTailscale(
  config: TailscaleConfig,
  runnerOS: string
): Promise<void> {
  const cacheKey = generateCacheKey(config, runnerOS);
  const toolPath = getToolPath(config, runnerOS);

  // Try to restore from cache first
  if (config.useCache && cacheKey) {
    const cacheHit = await cache.restoreCache([toolPath], cacheKey);
    if (cacheHit) {
      core.info(
        `Found Tailscale ${config.resolvedVersion} in cache: ${toolPath}`
      );

      // For Windows, install the cached MSI
      if (runnerOS === runnerWindows) {
        await installTailscaleWindows(config, toolPath, true);
      } else {
        // For Linux/macOS, copy binaries to /usr/local/bin
        await installCachedBinaries(toolPath, runnerOS);
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
      core.info(`Cached Tailscale ${config.resolvedVersion} at: ${toolPath}`);
    } catch (error) {
      const typedError = error as Error;
      if (typedError.name === cache.ValidationError.name) {
        throw error;
      } else if (typedError.name === cache.ReserveCacheError.name) {
        core.info(typedError.message);
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
  toolPath: string
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
    const { stdout } = await exec.getExecOutput("curl", [
      "-H",
      "user-agent:action-setup-tailscale",
      "-L",
      shaUrl,
      "--fail",
    ]);
    config.sha256Sum = stdout.trim();
  }

  // Download and extract
  const downloadUrl = `${baseUrl}/tailscale_${config.resolvedVersion}_${config.arch}.tgz`;
  core.info(`Downloading ${downloadUrl}`);

  const tarPath = await tc.downloadTool(downloadUrl, "tailscale.tgz");

  // Verify checksum
  const actualSha = await calculateFileSha256(tarPath);
  const expectedSha = config.sha256Sum.trim().toLowerCase();
  core.info(`Expected sha256: ${expectedSha}`);
  core.info(`Actual sha256: ${actualSha}`);
  if (actualSha !== expectedSha) {
    throw new Error("SHA256 checksum mismatch");
  }

  // Extract to tool path
  const extractedPath = await tc.extractTar(tarPath, undefined, "xz");
  const extractedDir = path.join(
    extractedPath,
    `tailscale_${config.resolvedVersion}_${config.arch}`
  );

  // Create tool directory and copy binaries there for caching
  fs.mkdirSync(toolPath, { recursive: true });
  fs.copyFileSync(
    path.join(extractedDir, cmdTailscale),
    path.join(toolPath, cmdTailscale)
  );
  fs.copyFileSync(
    path.join(extractedDir, cmdTailscaled),
    path.join(toolPath, cmdTailscaled)
  );

  // Install binaries to /usr/local/bin
  await exec.exec("sudo", [
    "cp",
    path.join(toolPath, cmdTailscale),
    path.join(toolPath, cmdTailscaled),
    "/usr/local/bin",
  ]);

  // Make sure they're executable
  await exec.exec("sudo", ["chmod", "+x", cmdTailscaleFullPath]);
  await exec.exec("sudo", ["chmod", "+x", cmdTailscaledFullPath]);
}

async function installTailscaleWindows(
  config: TailscaleConfig,
  toolPath: string,
  fromCache: boolean = false
): Promise<void> {
  // Create tool directory
  fs.mkdirSync(toolPath, { recursive: true });
  const msiPath = path.join(toolPath, "tailscale.msi");

  if (fromCache) {
    // Installing from cached MSI
    if (!fs.existsSync(msiPath)) {
      throw new Error(`Cached MSI not found at ${msiPath}`);
    }
    core.info(`Installing cached MSI from ${msiPath}`);
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
      const { stdout } = await exec.getExecOutput("curl", [
        "-H",
        "user-agent:action-setup-tailscale",
        "-L",
        shaUrl,
        "--fail",
      ]);
      config.sha256Sum = stdout.trim();
    }

    // Download MSI
    const downloadUrl = `${baseUrl}/tailscale-setup-${config.resolvedVersion}-${config.arch}.msi`;
    core.info(`Downloading ${downloadUrl}`);

    const downloadedMsiPath = await tc.downloadTool(downloadUrl, msiPath);

    // Verify checksum
    const actualSha = await calculateFileSha256(downloadedMsiPath);
    const expectedSha = config.sha256Sum.trim().toLowerCase();
    core.info(`Expected sha256: ${expectedSha}`);
    core.info(`Actual sha256: ${actualSha}`);
    if (actualSha !== expectedSha) {
      throw new Error("SHA256 checksum mismatch");
    }

    // Keep the MSI file in toolPath for caching (don't delete it)
    // The downloadedMsiPath is in temp, but we want to keep it in toolPath
    if (downloadedMsiPath !== msiPath) {
      fs.copyFileSync(downloadedMsiPath, msiPath);
    }
  }

  // Install MSI (same for both fresh and cached)
  await exec.exec("msiexec.exe", [
    "/quiet",
    `/l*v`,
    path.join(process.env.RUNNER_TEMP || "", "tailscale.log"),
    "/i",
    msiPath,
  ]);

  // Add to PATH
  core.addPath("C:\\Program Files\\Tailscale\\");
}

async function installTailscaleMacOS(
  config: TailscaleConfig,
  toolPath: string
): Promise<void> {
  core.info("Building tailscale from src on macOS...");

  // Clone the repo
  await exec.exec(
    "git clone https://github.com/tailscale/tailscale.git tailscale"
  );

  // Checkout the resolved version
  await exec.exec(`git checkout v${config.resolvedVersion}`, [], {
    cwd: cmdTailscale,
  });

  // Create tool directory and copy binaries there for caching
  fs.mkdirSync(toolPath, { recursive: true });

  // Build tailscale and tailscaled into tool directory
  for (const binary of [cmdTailscale, cmdTailscaled]) {
    await exec.exec(
      `./build_dist.sh -o ${path.join(toolPath, binary)} ./cmd/${binary}`,
      [],
      {
        cwd: cmdTailscale,
        env: {
          ...process.env,
          TS_USE_TOOLCHAIN: "1",
        },
      }
    );
  }

  // Install binaries to /usr/local/bin
  await exec.exec("sudo", [
    "cp",
    path.join(toolPath, cmdTailscale),
    path.join(toolPath, cmdTailscaled),
    "/usr/local/bin",
  ]);

  // Make sure they're executable
  await exec.exec("sudo", ["chmod", "+x", cmdTailscaleFullPath]);
  await exec.exec("sudo", ["chmod", "+x", cmdTailscaledFullPath]);

  core.info("✅ Tailscale installed successfully on macOS from source");
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

  core.info("Starting tailscaled daemon...");

  // Start daemon in background
  const daemon = spawn("sudo", ["-E", cmdTailscaled, ...args], {
    detached: true,
    stdio: [
      "ignore",
      "ignore",
      fs.openSync(path.join(os.homedir(), "tailscaled.log"), "w"),
    ],
  });

  daemon.unref(); // Ensure daemon doesn't keep Node.js process alive

  // Close stdin/stdout/stderr to fully detach
  if (daemon.stdin) daemon.stdin.end();
  if (daemon.stdout) daemon.stdout.destroy();
  if (daemon.stderr) daemon.stderr.destroy();

  // Poll the local API until daemon is responsive
  await waitForDaemonReady();

  core.info("✅ tailscaled daemon is up and running!");
}

async function waitForDaemonReady(): Promise<void> {
  const maxWaitMs = 15000; // 15 seconds
  const pollIntervalMs = 500;
  let waited = 0;

  core.info("Waiting for tailscaled daemon to become ready...");

  while (waited < maxWaitMs) {
    try {
      const status = await getTailscaleStatus();
      // If we get any valid response from the API, the daemon is ready
      if (status) {
        core.info(
          `Daemon ready! Initial state: ${status.BackendState || "Unknown"}`
        );
        return;
      }
    } catch (err) {
      // Daemon not ready yet, keep polling
      core.debug(`Waiting for daemon... (${waited}ms elapsed)`);
    }
    await sleep(pollIntervalMs);
    waited += pollIntervalMs;
  }

  throw new Error("tailscaled daemon did not become ready within timeout");
}

async function connectToTailscale(
  config: TailscaleConfig,
  runnerOS: string
): Promise<void> {
  // Determine hostname
  let hostname = config.hostname;
  if (!hostname) {
    if (runnerOS === runnerWindows) {
      hostname = `github-${process.env.COMPUTERNAME}`;
    } else {
      const { stdout } = await exec.getExecOutput("hostname");
      hostname = `github-${stdout.trim()}`;
    }
  }

  // Limit hostname to 63 characters (more will result in the error "not a valid DNS label")
  hostname = hostname.substring(0, 63);

  // Prepare auth and tags
  let finalAuthKey = config.authKey;
  const tagsArg: string[] = [];

  if (config.oauthSecret) {
    finalAuthKey = `${config.oauthSecret}?preauthorized=true&ephemeral=true`;
    if (config.tags) {
      tagsArg.push(`--advertise-tags=${config.tags}`);
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
    `--authkey=${finalAuthKey}`,
    `--hostname=${hostname}`,
    "--accept-routes",
    ...platformArgs,
    ...config.args.split(" ").filter(Boolean),
  ];

  // Retry logic
  for (let attempt = 1; attempt <= config.retry; attempt++) {
    try {
      core.info(`Attempt ${attempt} to bring up Tailscale...`);

      let execArgs: string[];
      if (runnerOS === runnerWindows) {
        execArgs = [cmdTailscale, ...upArgs];
      } else {
        // Linux and macOS - use system-installed binary with sudo
        execArgs = ["sudo", "-E", cmdTailscale, ...upArgs];
      }

      const timeoutMs = parseTimeout(config.timeout);
      core.info(`Running: ${execArgs.join(" ")} (timeout: ${timeoutMs}ms)`);

      await Promise.race([
        exec.exec(execArgs[0], execArgs.slice(1)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), timeoutMs)
        ),
      ]);

      // Success
      core.info(
        `✅ Tailscale up command completed successfully on attempt ${attempt}`
      );
      return;
    } catch (error) {
      core.warning(`Tailscale up attempt ${attempt} failed: ${error}`);
      if (attempt === config.retry) {
        throw error;
      }

      const sleepTime = attempt * 2; // Reduced from 5 to 2 seconds
      core.info(`Retrying in ${sleepTime} seconds...`);
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
  runnerOS: string
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
    `${runnerOS}-${config.arch}`
  );
}

async function installCachedBinaries(
  toolPath: string,
  runnerOS: string
): Promise<void> {
  if (runnerOS === runnerLinux || runnerOS === runnerMacOS) {
    // Copy cached binaries to /usr/local/bin
    const tailscaleBin = path.join(toolPath, cmdTailscale);
    const tailscaledBin = path.join(toolPath, cmdTailscaled);

    if (fs.existsSync(tailscaleBin) && fs.existsSync(tailscaledBin)) {
      await exec.exec("sudo", ["cp", tailscaleBin, cmdTailscaleFullPath]);
      await exec.exec("sudo", ["cp", tailscaledBin, cmdTailscaledFullPath]);
      await exec.exec("sudo", ["chmod", "+x", cmdTailscaleFullPath]);
      await exec.exec("sudo", ["chmod", "+x", cmdTailscaledFullPath]);
    } else {
      throw new Error(`Cached binaries not found in ${toolPath}`);
    }
  }
}

run();
