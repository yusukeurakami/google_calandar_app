#!/usr/bin/env bash
# Concatenates config + test overrides + main script + test runner
# into a single file and executes it with gas-fakes.
#
# Usage:
#   bash tests/run_test.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_FILE=$(mktemp /tmp/gas_test_XXXXXX.js)

cat "$SCRIPT_DIR/config.js" \
    "$SCRIPT_DIR/import_calendar.js" \
    "$SCRIPT_DIR/tests/test_config.js" \
    "$SCRIPT_DIR/tests/test_sync.js" \
    > "$TEMP_FILE"

echo "Running test..."
gas-fakes -f "$TEMP_FILE"
EXIT_CODE=$?

rm -f "$TEMP_FILE"
exit $EXIT_CODE
