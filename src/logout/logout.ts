// Copyright (c) Lee Briggs, Tailscale Inc, & Contributors
// SPDX-License-Identifier: BSD-3-Clause

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const runnerWindows = "Windows";
const runnerMacOS = "macOS";

type LogMode = "grouped" | "normal" | "quiet";

async function logout(): Promise<void> {
  try {
    const runnerOS = process.env.RUNNER_OS || "";
    const logMode = getLogMode();

    await withLogGroup(logMode, "Cleaning up Tailscale", async () => {
      if (runnerOS === runnerMacOS) {
        // The below is required to allow GitHub's post job cleanup to complete.
        logInfo(logMode, "Resetting DNS settings on macOS");
        await execCommand(logMode, "networksetup", [
          "-setdnsservers",
          "Ethernet",
          "Empty",
        ]);
        await execCommand(logMode, "networksetup", [
          "-setsearchdomains",
          "Ethernet",
          "Empty",
        ]);
      }

      logInfo(logMode, "🔄 Logging out of Tailscale...");

      // Check if tailscale is available first
      try {
        await execCommand(logMode, "tailscale", ["--version"], {
          silent: true,
        });

        // Determine the correct command based on OS
        let execArgs: string[];
        if (runnerOS === runnerWindows) {
          execArgs = ["tailscale", "logout"];
        } else {
          // Linux and macOS - use system-installed binary with sudo
          execArgs = ["sudo", "-E", "tailscale", "logout"];
        }

        logInfo(logMode, `Running: ${execArgs.join(" ")}`);

        try {
          await execCommand(logMode, execArgs[0], execArgs.slice(1));
          logInfo(logMode, "✅ Successfully logged out of Tailscale");
        } catch (error) {
          // Don't fail the action if logout fails - it's just cleanup
          core.warning(`Failed to logout from Tailscale: ${error}`);
          logInfo(
            logMode,
            "Your ephemeral node will eventually be cleaned up by Tailscale",
          );
        }
      } catch (error) {
        logInfo(
          logMode,
          "Tailscale not found or not accessible, skipping logout",
        );
        return;
      }

      logInfo(logMode, "Stopping tailscale");
      try {
        if (runnerOS === runnerWindows) {
          await execCommand(logMode, "net", ["stop", "Tailscale"]);
          await execCommand(logMode, "taskkill", [
            "/F",
            "/IM",
            "tailscale-ipn.exe",
          ]);
        } else {
          const xdgRuntimeDir =
            process.env.XDG_RUNTIME_DIR ||
            process.env.XDG_CACHE_HOME ||
            path.join(os.homedir(), ".cache");
          const pid = fs
            .readFileSync(path.join(xdgRuntimeDir, "tailscaled.pid"))
            .toString();
          if (pid === "") {
            throw new Error("pid file empty");
          }
          // The pid is actually the pid of the `sudo` parent of tailscaled, so use pkill -P to kill children of that parent
          await execCommand(logMode, "sudo", ["pkill", "-P", pid]);
          // Clean up DNS and routes.
          await execCommand(logMode, "sudo", ["tailscaled", "--cleanup"]);
        }
        logInfo(logMode, "✅ Stopped tailscale");
      } catch (error) {
        core.warning(`Failed to stop tailscale: ${error}`);
      }
    });
  } catch (error) {
    // Don't fail the action for post-cleanup issues
    core.warning(`Post-action cleanup error: ${error}`);
  }
}

function getLogMode(): LogMode {
  const logMode = core.getInput("log-mode") || "grouped";
  if (logMode !== "grouped" && logMode !== "normal" && logMode !== "quiet") {
    throw new Error(
      `Invalid log-mode "${logMode}". Expected "grouped", "normal", or "quiet".`,
    );
  }
  return logMode;
}

function logInfo(logMode: LogMode, message: string): void {
  if (logMode !== "quiet") {
    core.info(message);
  }
}

async function withLogGroup<T>(
  logMode: LogMode,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (logMode !== "grouped") {
    return fn();
  }

  core.startGroup(name);
  try {
    return await fn();
  } finally {
    core.endGroup();
  }
}

async function execCommand(
  logMode: LogMode,
  commandLine: string,
  args?: string[],
  options?: exec.ExecOptions,
): Promise<number> {
  return exec.exec(commandLine, args, {
    ...options,
    silent: options?.silent || logMode === "quiet",
  });
}

// Run the logout function
logout().catch((error) => {
  // Even if logout fails, don't fail the action
  core.warning(`Logout process failed: ${error}`);
});
