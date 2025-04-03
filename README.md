# Tailscale GitHub Action

This GitHub Action connects to your [Tailscale network](https://tailscale.com)
by adding a step to your workflow.

```yaml
  - name: Tailscale
    uses: tailscale/github-action@v3
    with:
      oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
      oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
      tags: tag:ci
```

Subsequent steps in the Action can then access nodes in your Tailnet.

oauth-client-id and oauth-secret are an [OAuth client](https://tailscale.com/s/oauth-clients/)
for the tailnet to be accessed. Required scope: `device` (read and write). We recommend storing these as
[GitHub Encrypted Secrets.](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
OAuth clients used for this purpose must have the
[`auth_keys` scope.](https://tailscale.com/kb/1215/oauth-clients#scopes)

tags is a comma-separated list of one or more [ACL Tags](https://tailscale.com/kb/1068/acl-tags/)
for the node. At least one tag is required: an OAuth client is not associated
with any of the Users on the tailnet, it has to Tag its nodes.

Nodes created by this Action are [marked as Ephemeral](https://tailscale.com/s/ephemeral-nodes) to
be automatically removed by the coordination server a short time after they
finish their run. The nodes are also [marked Preapproved](https://tailscale.com/kb/1085/auth-keys/)
on tailnets which use [Device Approval](https://tailscale.com/kb/1099/device-approval/)

## Tailnet Lock

If you are using this Action in a [Tailnet
Lock](https://tailscale.com/kb/1226/tailnet-lock) enabled network, you need to:

* Authenticate using an ephemeral reusable [pre-signed auth key](
  https://tailscale.com/kb/1226/tailnet-lock#add-a-node-using-a-pre-signed-auth-key)
  rather than an OAuth client.
* Specify a [state directory](
  https://tailscale.com/kb/1278/tailscaled#flags-to-tailscaled) for the
  client to store the Tailnet Key Authority data in.

```yaml
  - name: Tailscale
    uses: tailscale/github-action@v3
    with:
      authkey: tskey-auth-...
      statedir: /tmp/tailscale-state/
```

## Defining Tailscale version

Which Tailscale version to use can be set like this:

```yaml
  - name: Tailscale
    uses: tailscale/github-action@v3
    with:
      oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
      oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
      tags: tag:ci
      version: 1.52.0
```

If you'd like to specify the latest version, simply set the version as `latest`

```yaml
  - name: Tailscale
    uses: tailscale/github-action@v3
    with:
      oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
      oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
      tags: tag:ci
      version: latest
```

You can find the latest Tailscale stable version number at
https://pkgs.tailscale.com/stable/#static.
