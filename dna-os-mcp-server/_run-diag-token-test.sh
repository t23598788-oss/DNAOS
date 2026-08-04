#!/bin/bash
set +o history
cd "$(dirname "$0")" || exit 1

read -s -p "DNA_OS_API_TOKEN: " DNA_OS_API_TOKEN
echo
export DNA_OS_API_TOKEN

node _diag-token-test.mjs
EXIT=$?

unset DNA_OS_API_TOKEN
set -o history
exit $EXIT
