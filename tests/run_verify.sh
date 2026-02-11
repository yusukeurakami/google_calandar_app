#!/bin/bash
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")/.."
TEMP_FILE=$(mktemp /tmp/gas_verify_XXXXXX.js)

# Concatenate config and import_calendar (for constants) and verify script
cat "$SCRIPT_DIR/config.js" <(echo) \
    "$SCRIPT_DIR/import_calendar.js" <(echo) \
    "$SCRIPT_DIR/tests/verify_calendar.js" <(echo) \
    > "$TEMP_FILE"

# Run with gas-fakes
gas-fakes -f "$TEMP_FILE"

rm "$TEMP_FILE"
