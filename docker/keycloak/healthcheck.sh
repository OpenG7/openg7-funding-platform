#!/bin/bash
set -euo pipefail

# The official image has Bash but no curl/wget. Probe only its private interface.
exec 3<>/dev/tcp/127.0.0.1/9000
printf 'HEAD /health/ready HTTP/1.0\r\n\r\n' >&3
IFS= read -r -t 3 status <&3
exec 3<&-
exec 3>&-
[[ "$status" =~ ^HTTP/1\.[01]\ 200(\ |$) ]]
