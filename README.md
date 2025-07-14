# Connect Tailscale GitHub Action

A fast, reliable GitHub Action cross platform GitHub action to connect your GitHub runners to Tailscale.

## Why Use This Action?

While the [official Tailscale action](https://github.com/tailscale/github-action) is great, it is a [composite action](https://docs.github.com/en/actions/tutorials/creating-a-composite-action) which means some useful things aren't available to it.

This action is written in Typescript using official GitHub SDKs. It provides some improvements to the official action that might be interesting to you, such as:

### 🧹 **Automatic Cleanup**
- **Post-job logout**: Automatically runs `tailscale logout` when the job completes, ensuring clean disconnection

### ⚡ **Performance Optimizations**
- **Native TypeScript implementation**: Compiled to single JavaScript files for faster startup, comparison tests show this action is **40% faster** than the official action on Linux
- **Smart status checking**: Calls the localAPI to determine when the connection is ready, reducing the need for sleeps within the action
- **Modified Defaults**: The usage of more reliable status checking means the backoffs and retries can be tuned

### 🔧 **Enhanced Cross-Platform Support**
- **Native Support for All GitHub supported OSS**: Supports Linux, Windows, and macOS runners and all architectures
- **Native crypto verification**: Uses Node.js crypto module instead of external tools for SHA256 verification
- **Improved Windows handling**: Better MSI installation and authentication timing
- **macOS via Homebrew**: Simple and reliable installation using `brew install tailscale`
- **Consistent caching**: Caching built using the TypeScript SDKs meaning more flexibility.

## Usage

### Basic Usage

```yaml
- name: Connect to Tailscale
  uses: jaxxstorm/action-setup-tailscale@v1
  with:
    authkey: ${{ secrets.TAILSCALE_AUTHKEY }}
    version: latest
```

### OAuth Authentication (Recommended)

```yaml
- name: Connect to Tailscale
  uses: jaxxstorm/action-setup-tailscale@v1
  with:
    oauth-client-id: ${{ secrets.TAILSCALE_OAUTH_CLIENT_ID }}
    oauth-client-secret: ${{ secrets.TAILSCALE_OAUTH_CLIENT_SECRET }}
    tags: "ci,github-actions"
    version: latest
```

### Advanced Configuration

```yaml
- name: Connect to Tailscale
  uses: jaxxstorm/action-setup-tailscale@v1
  with:
    oauth-client-id: ${{ secrets.TAILSCALE_OAUTH_CLIENT_ID }}
    oauth-client-secret: ${{ secrets.TAILSCALE_OAUTH_CLIENT_SECRET }}
    tags: "ci,github-actions,deploy"
    version: "1.82.0"
    hostname: "ci-${{ github.run_id }}"
    timeout: "30s"
    retry: 3
    use-cache: true
    args: "--ssh"
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `authkey` | Tailscale authentication key | false | |
| `oauth-client-id` | OAuth Client ID | false | |
| `oauth-client-secret` | OAuth Client Secret | false | |
| `tags` | Comma-separated list of tags | false | |
| `version` | Tailscale version to install | true | `1.82.0` |
| `hostname` | Custom hostname | false | `github-<runner-name>` |
| `timeout` | Connection timeout | false | `60s` |
| `retry` | Number of retry attempts | false | `5` |
| `use-cache` | Enable binary caching | false | `false` |
| `args` | Additional `tailscale up` arguments | false | |
| `tailscaled-args` | Additional `tailscaled` arguments | false | |
| `statedir` | State directory (if empty, uses memory) | false | |
| `sha256sum` | Expected SHA256 checksum | false | |

## Authentication

### OAuth (Recommended)

OAuth provides better security and is the recommended approach:

1. Create an OAuth client in the [Tailscale admin panel](https://tailscale.com/s/oauth-clients)
2. Grant necessary permissions (typically "Write" for devices)
3. Add the client ID and secret to your GitHub repository secrets
4. Specify appropriate tags that the OAuth client can manage

### Auth Key (Legacy)

While still supported, auth keys are less secure for CI/CD:

1. Generate an auth key in the Tailscale admin panel
2. Add it to your GitHub repository secrets
3. Use the `authkey` input

## Platform Support

- ✅ **Linux** (Ubuntu, Amazon Linux, etc.)
- ✅ **Windows** (Windows Server 2019, 2022)
- ✅ **macOS** (macOS 11, 12, 13+)

## Caching

Enable caching to speed up subsequent workflow runs:

```yaml
- uses: jaxxstorm/action-setup-tailscale@v1
  with:
    use-cache: true
    # ... other inputs
```

**Benefits:**
- **Linux/macOS**: Caches extracted binaries
- **Windows**: Caches MSI installer
- **All platforms**: Includes SHA256 verification for integrity

## Performance Comparison

| Feature | This Action | Official Action |
|---------|-------------|-----------------|
| Default timeout | 60s | 2m |
| Retry interval | 2s incremental | 5s fixed |
| Windows status check | Native command | HTTP/Named pipes |
| Crypto verification | Native Node.js | External tools |
| Post-job cleanup | ✅ Automatic | ❌ Manual |
| MSI caching | ✅ Supported | ❌ Not available |

## Examples

### Deploy to Private Server

```yaml
name: Deploy
on: [push]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Connect to Tailscale
        uses: jaxxstorm/action-setup-tailscale@v1
        with:
          oauth-client-id: ${{ secrets.TAILSCALE_OAUTH_CLIENT_ID }}
          oauth-client-secret: ${{ secrets.TAILSCALE_OAUTH_CLIENT_SECRET }}
          tags: "ci,deploy"
          use-cache: true
      
      - name: Deploy to server
        run: |
          ssh deploy@private-server "deploy.sh"
```

### Multi-Platform Testing

```yaml
name: Test
on: [push]

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Connect to Tailscale
        uses: jaxxstorm/action-setup-tailscale@v1
        with:
          oauth-client-id: ${{ secrets.TAILSCALE_OAUTH_CLIENT_ID }}
          oauth-client-secret: ${{ secrets.TAILSCALE_OAUTH_CLIENT_SECRET }}
          tags: "ci,test"
          hostname: "test-${{ matrix.os }}-${{ github.run_id }}"
          use-cache: true
      
      - name: Run tests
        run: |
          # Your tests that require Tailscale connectivity
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build` to compile TypeScript
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Security

This action automatically logs out of Tailscale when the job completes, ensuring no persistent connections remain. For OAuth authentication, connections are ephemeral by default.

For security issues, please see our [security policy](SECURITY.md).
