#!/bin/bash
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")/.."
TEMP_FILE=$(mktemp /tmp/gas_debug_XXXXXX.js)

cat "$SCRIPT_DIR/config.js" <(echo) \
    "$SCRIPT_DIR/tests/gas_polyfills.js" <(echo) \
    "$SCRIPT_DIR/import_calendar.js" <(echo) \
    "$SCRIPT_DIR/tests/debug_ics.js" <(echo) \
    > "$TEMP_FILE"

# Append the call to debugICS()
echo "debugICS();" >> "$TEMP_FILE"

# Run with gas-fakes
gas-fakes -f "$TEMP_FILE"

# rm "$TEMP_FILE"
echo "Temp file preserved at: $TEMP_FILE"
