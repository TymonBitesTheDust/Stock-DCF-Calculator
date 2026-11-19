#!/bin/sh
# Builds everything and runs every test. Playwright (with Chromium) must be installed.
set -e
cd "$(dirname "$0")/.."
node build.mjs
node test/connector.mjs
node test/sync.cjs
echo "All tests passed."
