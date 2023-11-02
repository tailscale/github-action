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

tags is a comma-separated list of one or more [ACL Tags](https://tailscale.com/kb/1068/acl-tags/)
for the node. At least one tag is required: an OAuth client is not associated
with any of the Users on the tailnet, it has to Tag its nodes.

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

### Updating Tailscale as a dependancy

#### Renovate

If you already use [Renovate](https://docs.renovatebot.com/) to keep dependancies up to date you can use the [regex manager](https://docs.renovatebot.com/modules/manager/regex/) to keep the version of Tailscale used in your GitHub Action up to date by defining it as a dependency.

Here is an example of `renovate.json` that will look for the version string and compare it against the latest [tailscale/tailscale](https://github.com/tailscale/tailscale) GitHub Release.

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended"
  ],
  "customManagers": [
    {
      "customType": "regex",
      "fileMatch": ["^(workflow-templates|\.(?:github|gitea|forgejo)/workflows)/[^/]+\.ya?ml$"],
      "matchStrings": ["uses: tailscale\\/github-action@v2(?:\\s+.*\\n)*?.*version: (?<currentValue>.*?)\\n"],
      "depNameTemplate": "tailscale/tailscale",
      "datasourceTemplate": "github-releases",
      "extractVersionTemplate": "v(?<version>.*)"
    }
  ]
}
```