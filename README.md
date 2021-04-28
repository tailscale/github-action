# Tailscale GitHub Action

Connects your GitHub Action to your Tailscale network.

Usage:

    uses: tailscale/tailscale-deploy-github@main
    with:
	  authkey: ${{ secrets.TAILSCALE_AUTHKEY }} # from your GitHub repository secrets
