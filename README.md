# Tailscale GitHub Action

Connects your GitHub Action to your Tailscale network.

Usage:

    uses: tailscale/tailscale-deploy-github@v1
    env:
	  TAILSCALE_AUTHKEY: ${{ secrets.TAILSCALE_AUTHKEY }} # from your GitHub repository secrets
