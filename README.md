# Tailscale GitHub Action

This GitHub Action connects to your [Tailscale network](https://tailscale.com)
by adding a step to your workflow.

```yaml
  - name: Tailscale
    uses: tailscale/github-action@v1
      with:
        authkey: ${{ secrets.TAILSCALE_AUTHKEY }}
```

Subsequent steps in the Action can then access nodes in your Tailnet.

TAILSCALE\_AUTHKEY is an [authkey](https://tailscale.com/kb/1085/auth-keys/) 
for the Tailnet to be accessed, and needs to be populated in the Secrets for
your workflow. [Ephemeral authkeys](https://tailscale.com/kb/1111/ephemeral-nodes/) tend
to be a good fit for GitHub runners, as they clean up their state automatically shortly
after the runner finishes.

----

### Maintainer's Notes
This repository is provided and maintained by Tailscale. The CI script in this
repository uses an ephemeral authkey generated for the Tailnet owned by
TailscaleGitHubActionBot.github and stored as a Secret as described above.
