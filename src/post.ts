import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as os from 'os';

class TailscalePostAction {
  private isWindows: boolean;

  constructor() {
    this.isWindows = os.platform() === 'win32';
  }

  private async runTailscaleCommand(command: string, args: string[] = []): Promise<void> {
    try {
      const execArgs = this.isWindows 
        ? ['tailscale', command, ...args]
        : ['sudo', '-E', 'tailscale', command, ...args];
      
      await exec.exec(execArgs[0], execArgs.slice(1), {
        ignoreReturnCode: true
      });
    } catch (error) {
      core.warning(`Failed to run tailscale ${command}: ${error}`);
    }
  }

  private async generateBugReport(): Promise<void> {
    core.info('Generating Tailscale bug report...');
    
    try {
      await this.runTailscaleCommand('bugreport');
      core.info('Bug report generated successfully');
    } catch (error) {
      core.warning(`Failed to generate bug report: ${error}`);
    }
  }

  private async disconnectTailscale(): Promise<void> {
    core.info('Disconnecting from Tailscale...');
    
    try {
      await this.runTailscaleCommand('down');
      core.info('Disconnected from Tailscale successfully');
    } catch (error) {
      core.warning(`Failed to disconnect from Tailscale: ${error}`);
    }
  }

  private async logoutTailscale(): Promise<void> {
    core.info('Logging out of Tailscale...');
    
    try {
      await this.runTailscaleCommand('logout');
      core.info('Logged out of Tailscale successfully');
    } catch (error) {
      core.warning(`Failed to logout of Tailscale: ${error}`);
    }
  }

  private async stopDaemon(): Promise<void> {
    if (this.isWindows) {
      // On Windows, the service continues running
      core.info('Tailscale service will continue running on Windows');
      return;
    }

    core.info('Stopping Tailscale daemon...');
    
    try {
      // Try to stop the daemon gracefully
      await exec.exec('sudo', ['pkill', '-f', 'tailscaled'], {
        ignoreReturnCode: true
      });
      
      core.info('Tailscale daemon stopped');
    } catch (error) {
      core.warning(`Failed to stop Tailscale daemon: ${error}`);
    }
  }

  async run(): Promise<void> {
    try {
      core.info('Starting Tailscale post-action cleanup...');
      
      // Generate bug report for troubleshooting purposes
      await this.generateBugReport();
      
      // Disconnect from the Tailscale network
      await this.disconnectTailscale();
      
      // Logout to clean up authentication
      await this.logoutTailscale();
      
      // Stop the daemon (except on Windows)
      await this.stopDaemon();
      
      core.info('Tailscale post-action cleanup completed');
    } catch (error) {
      core.warning(`Post-action cleanup encountered errors: ${error}`);
      // Don't fail the action for cleanup issues
    }
  }
}

// Run the post action
if (require.main === module) {
  const postAction = new TailscalePostAction();
  postAction.run().catch(error => {
    core.warning(`Post-action failed: ${error}`);
    // Don't exit with error code for post actions
  });
}