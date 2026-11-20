#!/usr/bin/env bash
# Point apt at archive.ubuntu.com on GitHub-hosted runners that use an EC2 Ubuntu mirror.
#
# The runners hosted on AWS take their packages from us-east-2.ec2.archive.ubuntu.com, whatever
# their own region. On 2026-11-19 and 2026-11-20 it served many files at about 52 kB/s, and the
# step that installs the Linux candidate's 195 MB of packages took 3.5 to 46.6 minutes there,
# against 0.6 to 2.5 minutes on the runners hosted on Azure, whose own mirror this leaves alone.
# On the same AWS runners the clean ubuntu:24.04 container, which installs about 130 MB from
# archive.ubuntu.com, finished in a median of 21 seconds with its image pull and checks.
# apt checks every file against the signed archive index whichever mirror serves it. Where no
# EC2 mirror is configured, this changes nothing.
set -euo pipefail

ec2_host='[a-z0-9-]+\.ec2\.archive\.ubuntu\.com'
changed=0
for file in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/*; do
    if [[ ! -f "$file" ]] || ! grep -Eq "//$ec2_host/" "$file"; then
        continue
    fi
    sudo cp -- "$file" "$RUNNER_TEMP/apt-source.before"
    sudo sed -E -i "s#//$ec2_host/#//archive.ubuntu.com/#g" "$file"
    echo "$file:"
    diff "$RUNNER_TEMP/apt-source.before" "$file" || true
    changed=1
done
if ((changed)); then
    echo 'apt now fetches from archive.ubuntu.com instead of the EC2 mirror.'
else
    echo 'No EC2 Ubuntu mirror in the apt sources; they are left as they are.'
fi
