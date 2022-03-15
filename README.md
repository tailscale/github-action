# Tailscale GitHub Action

This GitHub Action connects to your [Tailscale network](https://tailscale.com)
by adding a step to your workflow.

↓ Use this action before you need access to your Tailnet in your workflow ↓
```yaml
  - name: Run Tailscale
    uses: tailscale/github-action@v2
      with:
        apikey: ${{ secrets.TAILSCALE_APIKEY }}
        tailnet: ${{ secrets.TAILSCALE_TAILNET }}
        # optional, overrides auto ephemeral authkey generation
        # authkey: ${{ secrets.TAILSCALE_AUTHKEY }} 
```

Subsequent steps in the Action can then access nodes in your Tailnet.

↓ Use this action at the end of your workflow to remove the ephemeral node from your Tailnet ↓
```yaml
  - name: Remove Tailscale
    if: always()
    uses: tailscale/github-action@v2
      with:
        action: down
        apikey: ${{ secrets.TAILSCALE_APIKEY }}
```

TAILSCALE\_APIKEY is an [apikey](https://github.com/tailscale/tailscale/blob/main/api.md)
for automatic [ephemeral authkey](https://tailscale.com/kb/1111/ephemeral-nodes/) 
generation. These tend to be a good fit for GitHub runners, as they clean up their state 
automatically shortly after the runner finishes.

TAILSCALE\_TAILNET is the name of the [tailnet](https://github.com/tailscale/tailscale/blob/main/api.md#tailnet) 
the runner will join if using automatic ephemeral auth. By default it is set to the 
tailnet that corresponds to your GitHub account.

TAILSCALE\_AUTHKEY is an [authkey](https://tailscale.com/kb/1085/auth-keys/) 
for the Tailnet to be accessed, and needs to be populated in the Secrets for
your workflow if not using automatic ephemeral auth.

----

### Maintainer's Notes
This repository is provided and maintained by Tailscale. The CI script in this
repository uses an ephemeral authkey generated for the Tailnet owned by
TailscaleGitHubActionBot.github and stored as a Secret as described above.
