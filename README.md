# Tailscale GitHub Action

Connects your GitHub Action to your Tailscale network.

Usage:

    uses: tailscale/github-action@main
    with:
	  authkey: ${{ secrets.TAILSCALE_AUTHKEY }} # from your GitHub repository secrets
