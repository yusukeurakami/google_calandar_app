#!/bin/bash
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")/.."
TEMP_FILE=$(mktemp /tmp/gas_cleanup_XXXXXX.js)

cat "$SCRIPT_DIR/config.js" <(echo) \
    "$SCRIPT_DIR/import_calendar.js" <(echo) \
    "$SCRIPT_DIR/tests/cleanup_calendar.js" <(echo) \
    > "$TEMP_FILE"

# Run with gas-fakes
gas-fakes -f "$TEMP_FILE"

rm "$TEMP_FILE"
