# Tailscale GitHub Action

This GitHub Action connects to your [Tailscale network](https://tailscale.com)
by adding a step to your workflow.

```yaml
  - name: Tailscale
    uses: tailscale/github-action@v2
    with:
      oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
      oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
      tags: tag:ci
```

Subsequent steps in the Action can then access nodes in your Tailnet.

oauth-client-id and oauth-secret are an [OAuth client](https://tailscale.com/s/oauth-clients/)
for the tailnet to be accessed. We recommend storing these as
[GitHub Encrypted Secrets.](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
When you make the OAuth client,
you will need to grant write access to Devices so that the node this action creates can be tagged.

tags is a comma-separated list of one or more [ACL Tags](https://tailscale.com/kb/1068/acl-tags/)
for the node.
At least one tag is required, and the policy file needs to allow tags to be applied.
For `tag:ci`, the policy files needs to include something like

```
"tagOwners": {
   ...
   "tag:ci": ["autogroup:admin"],
   ...
}
```

Nodes created by this Action are [marked as Ephemeral](https://tailscale.com/s/ephemeral-nodes) to
be automatically removed by the coordination server a short time after they
finish their run. The nodes are also [marked Preapproved](https://tailscale.com/kb/1085/auth-keys/)
on tailnets which use [Device Approval](https://tailscale.com/kb/1099/device-approval/)

## Defining Tailscale version

Which Tailscale version to use can be set like this:

```yaml
  - name: Tailscale
    uses: tailscale/github-action@v2
    with:
      oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
      oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
      tags: tag:ci
      version: 1.52.0
```
