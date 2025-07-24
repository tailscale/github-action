import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as http from '@actions/http-client';
import * as io from '@actions/io';
import * as tc from '@actions/tool-cache';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { 
  ActionInputs, 
  TailscaleVersion, 
  OSInfo, 
  TailscaleArchInfo, 
  DownloadInfo, 
  ConnectionConfig, 
  CacheInfo,
  RunnerOS,
  RunnerArch 
} from './interface';

class TailscaleAction {
  private inputs: ActionInputs;
  private osInfo: OSInfo;
  private httpClient: http.HttpClient;

  constructor() {
    this.inputs = this.getInputs();
    this.osInfo = this.getOSInfo();
    this.httpClient = new http.HttpClient('tailscale-github-action');
  }

  private getInputs(): ActionInputs {
    return {
      authkey: core.getInput('authkey'),
      oauthClientId: core.getInput('oauth-client-id'),
      oauthSecret: core.getInput('oauth-secret'),
      tags: core.getInput('tags'),
      version: core.getInput('version') || '1.82.0',
      sha256sum: core.getInput('sha256sum'),
      args: core.getInput('args'),
      tailscaledArgs: core.getInput('tailscaled-args'),
      hostname: core.getInput('hostname'),
      statedir: core.getInput('statedir'),
      timeout: core.getInput('timeout') || '2m',
      retry: core.getInput('retry') || '5',
      useCache: core.getInput('use-cache') || 'false'
    };
  }

  private getOSInfo(): OSInfo {
    const platform = os.platform();
    const arch = os.arch();
    
    return {
      platform,
      arch,
      isWindows: platform === 'win32',
      isLinux: platform === 'linux',
      isMacOS: platform === 'darwin'
    };
  }

  private validateRunnerOS(): void {
    if (!this.osInfo.isLinux && !this.osInfo.isWindows && !this.osInfo.isMacOS) {
      core.setFailed('⛔ error hint::Support Linux, Windows, and macOS Only');
      throw new Error('Unsupported OS');
    }
  }

  private validateAuthInfo(): void {
    const hasAuthkey = this.inputs.authkey !== '';
    const hasOAuth = this.inputs.oauthSecret !== '' && this.inputs.tags !== '';
    
    if (!hasAuthkey && !hasOAuth) {
      core.setFailed('⛔ error hint::OAuth identity empty, Maybe you need to populate it in the Secrets for your workflow, see more in https://docs.github.com/en/actions/security-guides/encrypted-secrets and https://tailscale.com/s/oauth-clients');
      throw new Error('Authentication information is missing');
    }
  }

  private async resolveVersion(): Promise<string> {
    if (this.inputs.version === 'latest') {
      try {
        const response = await this.httpClient.get('https://pkgs.tailscale.com/stable/?mode=json');
        const body = await response.readBody();
        const versionInfo: TailscaleVersion = JSON.parse(body);
        
        core.info(`Resolved Tailscale version: ${versionInfo.Version}`);
        core.exportVariable('RESOLVED_VERSION', versionInfo.Version);
        return versionInfo.Version;
      } catch (error) {
        core.setFailed(`Failed to resolve latest version: ${error}`);
        throw error;
      }
    } else {
      core.info(`Resolved Tailscale version: ${this.inputs.version}`);
      core.exportVariable('RESOLVED_VERSION', this.inputs.version);
      return this.inputs.version;
    }
  }

  private getTailscaleArch(): string {
    const runnerArch = process.env.RUNNER_ARCH || 'X64';
    
    if (this.osInfo.isLinux) {
      switch (runnerArch) {
        case RunnerArch.ARM64: return 'arm64';
        case RunnerArch.ARM: return 'arm';
        case RunnerArch.X86: return '386';
        default: return 'amd64';
      }
    } else if (this.osInfo.isWindows) {
      switch (runnerArch) {
        case RunnerArch.ARM64: return 'arm64';
        case RunnerArch.X86: return 'x86';
        default: return 'amd64';
      }
    } else {
      // macOS uses Go's GOARCH naming
      switch (runnerArch) {
        case RunnerArch.ARM64: return 'arm64';
        default: return 'amd64';
      }
    }
  }

  private async getSHA256Sum(resolvedVersion: string, arch: string): Promise<string> {
    if (this.inputs.sha256sum) {
      return this.inputs.sha256sum;
    }

    const minor = parseInt(resolvedVersion.split('.')[1]);
    const isStable = minor % 2 === 0;
    const channel = isStable ? 'stable' : 'unstable';
    
    let url: string;
    if (this.osInfo.isLinux) {
      url = `https://pkgs.tailscale.com/${channel}/tailscale_${resolvedVersion}_${arch}.tgz.sha256`;
    } else if (this.osInfo.isWindows) {
      url = `https://pkgs.tailscale.com/${channel}/tailscale-setup-${resolvedVersion}-${arch}.msi.sha256`;
    } else {
      // macOS doesn't use pre-built checksums
      return '';
    }

    try {
      const response = await this.httpClient.get(url);
      const sha256 = await response.readBody();
      return sha256.trim();
    } catch (error) {
      core.setFailed(`Failed to get SHA256 checksum: ${error}`);
      throw error;
    }
  }

  private getDownloadInfo(resolvedVersion: string, arch: string): DownloadInfo {
    const minor = parseInt(resolvedVersion.split('.')[1]);
    const isStable = minor % 2 === 0;
    const channel = isStable ? 'stable' : 'unstable';
    
    if (this.osInfo.isLinux) {
      return {
        url: `https://pkgs.tailscale.com/${channel}/tailscale_${resolvedVersion}_${arch}.tgz`,
        filename: 'tailscale.tgz',
        sha256: ''
      };
    } else if (this.osInfo.isWindows) {
      return {
        url: `https://pkgs.tailscale.com/${channel}/tailscale-setup-${resolvedVersion}-${arch}.msi`,
        filename: 'tailscale.msi',
        sha256: ''
      };
    } else {
      throw new Error('macOS uses source build, not downloads');
    }
  }

  private getCacheInfo(resolvedVersion: string, arch: string, sha256: string, commitHash?: string): CacheInfo {
    const enabled = this.inputs.useCache === 'true';
    if (!enabled) {
      return { enabled: false, key: '', paths: [] };
    }

    const runnerOS = process.env.RUNNER_OS || 'Linux';
    
    if (this.osInfo.isLinux) {
      return {
        enabled: true,
        key: `${runnerOS}-tailscale-${resolvedVersion}-${arch}-${sha256}`,
        paths: ['tailscale.tgz']
      };
    } else if (this.osInfo.isWindows) {
      return {
        enabled: true,
        key: `${runnerOS}-tailscale-${resolvedVersion}-${arch}-${sha256}`,
        paths: ['tailscale.msi']
      };
    } else if (this.osInfo.isMacOS && commitHash) {
      return {
        enabled: true,
        key: `${runnerOS}-tailscale-${resolvedVersion}-${process.env.RUNNER_ARCH}-${commitHash}`,
        paths: ['/usr/local/bin/tailscale', '/usr/local/bin/tailscaled']
      };
    }
    
    return { enabled: false, key: '', paths: [] };
  }

  private async downloadAndVerify(downloadInfo: DownloadInfo, sha256: string): Promise<void> {
    core.info(`Downloading ${downloadInfo.url}`);
    
    try {
      const downloadPath = await tc.downloadTool(downloadInfo.url, downloadInfo.filename);
      
      if (sha256) {
        const fileBuffer = await fs.readFile(downloadPath);
        const actualSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        
        core.info(`Expected sha256: ${sha256}`);
        core.info(`Actual sha256: ${actualSha256}`);
        
        if (actualSha256 !== sha256) {
          throw new Error(`SHA256 checksum mismatch. Expected: ${sha256}, Actual: ${actualSha256}`);
        }
      }
      
      // Move the file to the expected location
      await io.mv(downloadPath, downloadInfo.filename);
    } catch (error) {
      core.setFailed(`Download failed: ${error}`);
      throw error;
    }
  }

  private async installLinux(resolvedVersion: string, arch: string): Promise<void> {
    core.info('Installing Tailscale on Linux...');
    
    try {
      // Extract the tarball
      await exec.exec('tar', ['-C', '/tmp', '-xzf', 'tailscale.tgz']);
      
      // Remove the tarball
      await fs.unlink('tailscale.tgz');
      
      // Move binaries to /usr/bin
      const extractPath = `/tmp/tailscale_${resolvedVersion}_${arch}`;
      await exec.exec('sudo', ['mv', `${extractPath}/tailscale`, `${extractPath}/tailscaled`, '/usr/bin']);
    } catch (error) {
      core.setFailed(`Linux installation failed: ${error}`);
      throw error;
    }
  }

  private async installWindows(): Promise<void> {
    core.info('Installing Tailscale on Windows...');
    
    try {
      const tempDir = process.env.RUNNER_TEMP || os.tmpdir();
      const logPath = path.join(tempDir, 'tailscale.log');
      
      // Install MSI package
      await exec.exec('msiexec.exe', [
        '/quiet',
        `/l*v "${logPath}"`,
        '/i',
        'tailscale.msi'
      ]);
      
      // Add to PATH
      core.addPath('C:\\Program Files\\Tailscale\\');
      
      // Remove the installer
      await fs.unlink('tailscale.msi');
    } catch (error) {
      core.setFailed(`Windows installation failed: ${error}`);
      throw error;
    }
  }

  private async installMacOS(resolvedVersion: string): Promise<string> {
    core.info('Installing Tailscale on macOS...');
    
    try {
      const workspacePath = process.env.GITHUB_WORKSPACE || process.cwd();
      const tailscalePath = path.join(workspacePath, 'tailscale');
      
      // Checkout Tailscale repository
      await exec.exec('git', [
        'clone',
        '--depth', '1',
        '--branch', `v${resolvedVersion}`,
        'https://github.com/tailscale/tailscale.git',
        tailscalePath
      ]);
      
      const originalCwd = process.cwd();
      process.chdir(tailscalePath);
      
      try {
        // Set environment variable
        core.exportVariable('TS_USE_TOOLCHAIN', '1');
        
        // Build binaries
        await exec.exec('./build_dist.sh', ['./cmd/tailscale']);
        await exec.exec('./build_dist.sh', ['./cmd/tailscaled']);
        
        // Move binaries
        await exec.exec('sudo', ['mv', 'tailscale', 'tailscaled', '/usr/local/bin']);
        
        // Get commit hash for caching
        let commitHash = '';
        await exec.exec('git', ['rev-parse', 'HEAD'], {
          listeners: {
            stdout: (data) => {
              commitHash += data.toString();
            }
          }
        });
        
        return commitHash.trim();
      } finally {
        process.chdir(originalCwd);
        // Clean up checkout
        await io.rmRF(tailscalePath);
      }
    } catch (error) {
      core.setFailed(`macOS installation failed: ${error}`);
      throw error;
    }
  }

  private async installTimeoutMacOS(): Promise<void> {
    if (this.osInfo.isMacOS) {
      core.info('Installing timeout utility on macOS...');
      try {
        await exec.exec('brew', ['install', 'coreutils']);
      } catch (error) {
        core.warning(`Failed to install coreutils (timeout): ${error}`);
      }
    }
  }

  private async startDaemon(): Promise<void> {
    if (this.osInfo.isWindows) {
      // Windows daemon starts automatically
      return;
    }

    core.info('Starting Tailscale daemon...');
    
    try {
      const stateArgs = this.inputs.statedir 
        ? `--statedir=${this.inputs.statedir}`
        : '--state=mem:';
      
      if (this.inputs.statedir) {
        await io.mkdirP(this.inputs.statedir);
      }
      
      const daemonArgs = [stateArgs];
      if (this.inputs.tailscaledArgs) {
        daemonArgs.push(...this.inputs.tailscaledArgs.split(' ').filter(arg => arg.length > 0));
      }
      
      // Start daemon in background
      const homeDir = os.homedir();
      const logFile = path.join(homeDir, 'tailscaled.log');
      
      // Start daemon in background by spawning process directly
      const spawn = require('child_process').spawn;
      const daemon = spawn('sudo', ['-E', 'tailscaled', ...daemonArgs], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore']
      });
      daemon.unref();
      
      // Wait for daemon to be ready
      await exec.exec('sudo', ['-E', 'tailscale', 'status', '--json'], {
        ignoreReturnCode: true
      });
    } catch (error) {
      core.setFailed(`Failed to start Tailscale daemon: ${error}`);
      throw error;
    }
  }

  private async connectToTailscale(resolvedVersion: string): Promise<void> {
    core.info('Connecting to Tailscale...');
    
    try {
      const config = this.buildConnectionConfig();
      const retryCount = parseInt(this.inputs.retry);
      
      for (let i = 1; i <= retryCount; i++) {
        core.info(`Attempt ${i} to bring up Tailscale...`);
        
        try {
          const connectArgs = this.buildConnectArgs(config);
          const execArgs = this.osInfo.isWindows 
            ? ['tailscale', 'up', ...connectArgs]
            : ['sudo', '-E', 'tailscale', 'up', ...connectArgs];
          
          await exec.exec('timeout', [
            '--verbose',
            '--kill-after=1s',
            config.timeout,
            ...execArgs
          ]);
          
          core.info('Successfully connected to Tailscale!');
          return;
        } catch (error) {
          if (i === retryCount) {
            throw error;
          }
          
          const delay = i * 5;
          core.info(`Tailscale up failed. Retrying in ${delay} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }
      }
    } catch (error) {
      core.setFailed(`Failed to connect to Tailscale: ${error}`);
      throw error;
    }
  }

  private buildConnectionConfig(): ConnectionConfig {
    let hostname = this.inputs.hostname;
    if (!hostname) {
      hostname = this.osInfo.isWindows 
        ? `github-${process.env.COMPUTERNAME || 'runner'}`
        : `github-${os.hostname()}`;
    }
    
    let authkey = this.inputs.authkey;
    let tags = undefined;
    
    if (this.inputs.oauthSecret) {
      authkey = `${this.inputs.oauthSecret}?preauthorized=true&ephemeral=true`;
      tags = this.inputs.tags;
    }
    
    const platformSpecificArgs = this.osInfo.isWindows ? '--unattended' : '';
    
    return {
      authkey,
      hostname,
      tags,
      additionalArgs: this.inputs.args,
      timeout: this.inputs.timeout,
      retry: parseInt(this.inputs.retry),
      platformSpecificArgs
    };
  }

  private buildConnectArgs(config: ConnectionConfig): string[] {
    const args: string[] = [];
    
    if (config.tags) {
      args.push(`--advertise-tags=${config.tags}`);
    }
    
    args.push(`--authkey=${config.authkey}`);
    args.push(`--hostname=${config.hostname}`);
    args.push('--accept-routes');
    
    if (config.platformSpecificArgs) {
      args.push(...config.platformSpecificArgs.split(' ').filter(arg => arg.length > 0));
    }
    
    if (config.additionalArgs) {
      args.push(...config.additionalArgs.split(' ').filter(arg => arg.length > 0));
    }
    
    return args;
  }

  async run(): Promise<void> {
    try {
      core.info('Starting Tailscale GitHub Action...');
      
      // Validation
      this.validateRunnerOS();
      this.validateAuthInfo();
      
      // Resolve version
      const resolvedVersion = await this.resolveVersion();
      const arch = this.getTailscaleArch();
      core.exportVariable('TS_ARCH', arch);
      
      // Handle installation based on OS
      if (this.osInfo.isMacOS) {
        // macOS: Check cache, build from source if needed
        const cacheInfo = this.getCacheInfo(resolvedVersion, arch, '', 'placeholder');
        // TODO: Implement cache restore/save for macOS
        
        const commitHash = await this.installMacOS(resolvedVersion);
        await this.installTimeoutMacOS();
      } else {
        // Linux/Windows: Download and install binaries
        const sha256 = await this.getSHA256Sum(resolvedVersion, arch);
        core.exportVariable('SHA256SUM', sha256);
        
        const cacheInfo = this.getCacheInfo(resolvedVersion, arch, sha256);
        // TODO: Implement cache restore/save for Linux/Windows
        
        const downloadInfo = this.getDownloadInfo(resolvedVersion, arch);
        await this.downloadAndVerify(downloadInfo, sha256);
        
        if (this.osInfo.isLinux) {
          await this.installLinux(resolvedVersion, arch);
        } else if (this.osInfo.isWindows) {
          await this.installWindows();
        }
      }
      
      // Start daemon and connect
      await this.startDaemon();
      await this.connectToTailscale(resolvedVersion);
      
      core.info('Tailscale GitHub Action completed successfully!');
    } catch (error) {
      core.setFailed(`Action failed: ${error}`);
      throw error;
    }
  }
}

// Run the action
if (require.main === module) {
  const action = new TailscaleAction();
  action.run().catch(error => {
    core.setFailed(`Unhandled error: ${error}`);
    process.exit(1);
  });
}
