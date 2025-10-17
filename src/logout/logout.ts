// Copyright (c) Lee Briggs, Tailscale Inc, & Contributors
// SPDX-License-Identifier: BSD-3-Clause

import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";

const runnerWindows = "Windows";
const runnerMacOS = "macOS";

async function logout(): Promise<void> {
  try {
    const runnerOS = process.env.RUNNER_OS || "";

    if (runnerOS === runnerMacOS) {
      // The below is required to allow GitHub's post job cleanup to complete.
      core.info("Resetting DNS settings on macOS");
      await exec.exec("networksetup", ["-setdnsservers", "Ethernet", "Empty"]);
      await exec.exec("networksetup", [
        "-setsearchdomains",
        "Ethernet",
        "Empty",
      ]);
    }

    core.info("🔄 Logging out of Tailscale...");

    // Check if tailscale is available first
    try {
      await exec.exec("tailscale", ["--version"], { silent: true });

      // Determine the correct command based on OS
      let execArgs: string[];
      if (runnerOS === runnerWindows) {
        execArgs = ["tailscale", "logout"];
      } else {
        // Linux and macOS - use system-installed binary with sudo
        execArgs = ["sudo", "-E", "tailscale", "logout"];
      }

      core.info(`Running: ${execArgs.join(" ")}`);

      try {
        await exec.exec(execArgs[0], execArgs.slice(1));
        core.info("✅ Successfully logged out of Tailscale");
      } catch (error) {
        // Don't fail the action if logout fails - it's just cleanup
        core.warning(`Failed to logout from Tailscale: ${error}`);
        core.info(
          "Your ephemeral node will eventually be cleaned up by Tailscale"
        );
      }
    } catch (error) {
      core.info("Tailscale not found or not accessible, skipping logout");
      return;
    }

    core.info("Stopping tailscale");
    try {
      if (runnerOS === runnerWindows) {
        await exec.exec("net", ["stop", "Tailscale"]);
        await exec.exec("taskkill", ["/F", "/IM", "tailscale-ipn.exe"]);
      } else {
        const pid = fs.readFileSync("tailscaled.pid").toString();
        if (pid === "") {
          throw new Error("pid file empty");
        }
        // The pid is actually the pid of the `sudo` parent of tailscaled, so use pkill -P to kill children of that parent
        await exec.exec("sudo", ["pkill", "-P", pid]);
        // Clean up DNS and routes.
        await exec.exec("sudo", ["tailscaled", "--cleanup"]);
      }
      core.info("✅ Stopped tailscale");
    } catch (error) {
      core.warning(`Failed to stop tailscale: ${error}`);
    }
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
