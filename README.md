# deploy action

To use:

Set secret `TAILSCALE_AUTHKEY` to your authentication key.

    uses: tailscale/deploy-action
    with:
        machine-name: 'hydrogen' # replace with hostname or IP address of machine to deploy to