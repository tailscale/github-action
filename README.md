# Tailscale GitHub Action

This GitHub Action connects to your [Tailscale network](https://tailscale.com)
by adding a step to your workflow.

```yaml
- name: Tailscale
  uses: tailscale/github-action@v4
  with:
    oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
    oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
    tags: tag:ci
```

Subsequent steps in the Action can then access nodes in your Tailnet.

oauth-client-id and oauth-secret are an [OAuth client](https://tailscale.com/s/oauth-clients/)
for the tailnet to be accessed. We recommend storing these as
[GitHub Encrypted Secrets.](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
OAuth clients used for this purpose must have the
[`auth_keys` scope.](https://tailscale.com/kb/1215/oauth-clients#scopes)

tags is a comma-separated list of one or more [ACL Tags](https://tailscale.com/kb/1068/acl-tags/)
for the node. At least one tag is required: an OAuth client is not associated
with any of the Users on the tailnet, it has to Tag its nodes.

Nodes created by this Action are [marked as Ephemeral](https://tailscale.com/s/ephemeral-nodes) to
and log out immediately after finishing their CI run, at which point they are automatically removed
by the coordination server. The nodes are also [marked Preapproved](https://tailscale.com/kb/1085/auth-keys/)
on tailnets which use [Device Approval](https://tailscale.com/kb/1099/device-approval/)

## Prerequisites

Before using the Tailscale GitHub Action, ensure you have the following:

1. A Tailscale account with <Role>Owner, Admin, or Network admin</Role> permissions.
1. A GitHub repository that you have admin access to (required to set up the GitHub Action).
1. At least one configured [tag][kb-tags].
1. An [OAuth client][kb-oauth-clients] ID and secret OR an [auth key][kb-auth-keys].
1. A runner image version >= 2.237.1 (required to support running Node.js 24).

## Eventual consistency

Propagating information about new peers - such as the node created by this action - across your tailnet
is an eventually consistent process, and brief delays are expected. Until the GitHub workflow node
becomes visible, other peers will not accept connections. It is best to verify connectivity to the
intended nodes before executing steps that rely on them.

You can do this by adding a list of hosts to ping to the action configuration:

```yaml
- name: Tailscale
  uses: tailscale/github-action@v4
  with:
    ping: 100.x.y.z,my-machine.my-tailnet.ts.net
```

or with the [tailscale ping](https://tailscale.com/kb/1080/cli#ping) command if you do not know the peers at the time of installing Tailscale in the workflow:

```bash
tailscale ping my-target.my-tailnet.ts.net
```

The `ping` option will wait up to to 3 minutes for a connection (direct or relayed).

## Tailnet Lock

If you are using this Action in a [Tailnet
Lock](https://tailscale.com/kb/1226/tailnet-lock) enabled network, you need to:

- Authenticate using an ephemeral reusable [pre-signed auth key](https://tailscale.com/kb/1226/tailnet-lock#add-a-node-using-a-pre-signed-auth-key)
  rather than an OAuth client.
- Specify a [state directory](https://tailscale.com/kb/1278/tailscaled#flags-to-tailscaled) for the
  client to store the Tailnet Key Authority data in.

```yaml
- name: Tailscale
  uses: tailscale/github-action@v4
  with:
    authkey: tskey-auth-...
    statedir: /tmp/tailscale-state/
```

## Defining Tailscale version

Which Tailscale version to use can be set like this:

```yaml
- name: Tailscale
  uses: tailscale/github-action@v4
  with:
    oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
    oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
    tags: tag:ci
    version: 1.52.0
```

If you'd like to specify the latest version, simply set the version as `latest`

```yaml
- name: Tailscale
  uses: tailscale/github-action@v4
  with:
    oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
    oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
    tags: tag:ci
    version: latest
```

You can find the latest Tailscale stable version number at
https://pkgs.tailscale.com/stable/#static.

You can also specify `version: unstable` to use the latest unstable version of Tailscale.
For Linux and Windows, this uses the version published at https://pkgs.tailscale.com/unstable,
and for MacOS it uses the HEAD of the `main` branch of https://github.com/tailscale/tailscale/.

## Cache Tailscale binaries

Caching can reduce download times and download failures on runners with slower network connectivity.
As of v4 of this action, caching is enabled by default.

Although caching is generally recommended, you can disable it by passing `'false'` to the `use-cache` input:

```yaml
- name: Tailscale
  uses: tailscale/github-action@v4
  with:
    oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
    oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
    use-cache: "false"
```

## Usage on persistent self-hosted runners

When running on self-hosted runners that persist after CI jobs have finished,
the GitHub Action leaves tailscale binaries installed but stops the tailscale background processes.

## Troubleshooting

### requested tags [tag:mytag] are invalid or not permitted

You may encounter this error when using an OAuth client. OAuth clients must have the [`auth_keys` scope](https://tailscale.com/kb/1215/oauth-clients#scopes) with one or more [tags](https://tailscale.com/kb/1068/acl-tags/), and the tags specified with `tags` must match all tags on the OAuth client.