# Tailscale GitHub Action

Connects your GitHub Action to your Tailscale network.

Usage:

    uses: tailscale/github-action@main
    with:
	  authkey: ${{ secrets.TAILSCALE_AUTHKEY }} # from your GitHub repository secrets

### Maintainer's Notes
This repository is provided and maintained by Tailscale, Inc.

The CI script in this repository uses an ephemeral authkey generated for the
Tailnet owned by TailscaleGitHubActionBot.github. A new ephemeral authkey will
need to be generated every 3 months and placed in the TAILSCALE\_AUTHKEY in
the Secrets for this repository.

If a CI run fails, it is likely because the Ephemeral Authkey expired since
the last time it was run. You should generate a new key.
