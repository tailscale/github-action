// Copyright (c) Lee Briggs, Tailscale Inc, & Contributors
// SPDX-License-Identifier: BSD-3-Clause

import * as core from "@actions/core";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execCommand, getLogMode, logInfo, withLogGroup } from "../logging";

const runnerWindows = "Windows";
const runnerMacOS = "macOS";

async function logout(): Promise<void> {
  try {
    const runnerOS = process.env.RUNNER_OS || "";
    const logMode = getLogMode();

    await withLogGroup(logMode, "Cleaning up Tailscale", async () => {
      if (runnerOS === runnerMacOS) {
        // The below is required to allow GitHub's post job cleanup to complete.
        logInfo(logMode, "Resetting DNS settings on macOS");
        await execCommand(
          "networksetup",
          ["-setdnsservers", "Ethernet", "Empty"],
          { logMode },
        );
        await execCommand(
          "networksetup",
          ["-setsearchdomains", "Ethernet", "Empty"],
          { logMode },
        );
      }

      logInfo(logMode, "🔄 Logging out of Tailscale...");

      // Check if tailscale is available first
      try {
        await execCommand("tailscale", ["--version"], {
          logMode,
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
          await execCommand(execArgs[0], execArgs.slice(1), { logMode });
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
          await execCommand("net", ["stop", "Tailscale"], { logMode });
          await execCommand("taskkill", ["/F", "/IM", "tailscale-ipn.exe"], {
            logMode,
          });
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
          await execCommand("sudo", ["pkill", "-P", pid], { logMode });
          // Clean up DNS and routes.
          await execCommand("sudo", ["tailscaled", "--cleanup"], { logMode });
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

// Run the logout function
logout().catch((error) => {
  // Even if logout fails, don't fail the action
  core.warning(`Logout process failed: ${error}`);
});
