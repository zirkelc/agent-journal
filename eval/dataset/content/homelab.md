# homelab

homelab is the configuration of the user's home servers, in a git repository: a small Proxmox server, a Synology NAS, a Raspberry Pi. The agent edits the configuration files and the scripts, and runs commands over SSH.

## Stack

Proxmox with a few virtual machines and LXC containers, Docker Compose for the services, Ansible for the setup, restic for the backups to the NAS and to a cloud bucket, Pi-hole and Unbound for DNS, WireGuard for the VPN, Jellyfin as the media server, Home Assistant, Caddy as the reverse proxy, Uptime Kuma for checks. Never Kubernetes or k3s.

## Timeline (days relative to today, negative is the past)

- -1050 to -800: the first setup: the NAS shares, the backup job with restic, Pi-hole, the reverse proxy and its certificates.
- -800 to -500: the VPN, Jellyfin, Home Assistant, a new disk in the NAS, the update script for all containers, the first time a restore from the backup was tested.
- -500 to -200: the move of the services to Ansible, the monitoring with Uptime Kuma, a UPS and a clean shutdown when the power fails, IPv6.
- -200 to -2: small fixes: updates that broke something, a disk that shows errors, the backup job that ran too long, a second DNS server.

## Branches

None. Every session runs in the main checkout.
