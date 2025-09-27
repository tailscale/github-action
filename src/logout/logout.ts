import * as core from "@actions/core";
import * as exec from "@actions/exec";

async function logout(): Promise<void> {
  try {
    const runnerOS = process.env.RUNNER_OS || "";

    core.info("🔄 Logging out of Tailscale...");

    // Check if tailscale is available first
    try {
      await exec.exec("tailscale", ["--version"], { silent: true });
    } catch (error) {
      core.info("Tailscale not found or not accessible, skipping logout");
      return;
    }

    // Determine the correct command based on OS
    let execArgs: string[];
    if (runnerOS === "Windows") {
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
    // Don't fail the action for post-cleanup issues
    core.warning(`Post-action cleanup error: ${error}`);
  }
}

// Run the logout function
logout().catch((error) => {
  // Even if logout fails, don't fail the action
  core.warning(`Logout process failed: ${error}`);
});
