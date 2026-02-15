/**
 * @fileoverview Local test to verify RECURRENCE-ID parsing and composite key
 * generation in parseICSContent().
 *
 * Runs with plain Node.js (no gas-fakes needed). Loads import_calendar.js
 * after setting up minimal polyfills.
 *
 * Usage:
 *   node tests/test_recurrence_key.js
 */

var fs = require('fs');
var path = require('path');

// --- Minimal GAS polyfills ---
var Logger = { log: function(msg) { /* silent */ } };
var TIMEZONE_MAP = {
    'Tokyo Standard Time': 'Asia/Tokyo',
    'Pacific Standard Time': 'America/Los_Angeles',
    'Eastern Standard Time': 'America/New_York'
};
var Utilities_parseDate_Mock = function(dateStr, tz, fmt) {
    var p = dateStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    return new Date(Date.UTC(+p[1], +p[2] - 1, +p[3], +p[4], +p[5], +p[6]));
};

// --- Load parseICSContent and parseICSDate from import_calendar.js ---
var scriptPath = path.join(__dirname, '..', 'import_calendar.js');
var scriptSrc = fs.readFileSync(scriptPath, 'utf8');

// Extract only parseICSContent and parseICSDate (skip GAS-only functions)
eval(scriptSrc.substring(scriptSrc.indexOf('function parseICSContent')));

// --- Run tests ---
var icsPath = path.join(__dirname, 'latest_cal.ics');
var icsContent = fs.readFileSync(icsPath, 'utf8');

var events = parseICSContent(icsContent);

console.log('Total events parsed: ' + events.length);

// 1. Check GSRD-1 recurring events
var gsrdEvents = events.filter(function(e) {
    return e.summary.indexOf('GSRD-1') >= 0;
});
console.log('\n--- GSRD-1定例 events ---');
console.log('Count: ' + gsrdEvents.length + ' (expected: 17)');

var gsrdKeySet = {};
gsrdEvents.forEach(function(e) {
    gsrdKeySet[e.recurrenceKey] = (gsrdKeySet[e.recurrenceKey] || 0) + 1;
    console.log('  recId=' + (e.recurrenceId || '(none)').padEnd(20) +
        ' key=' + e.recurrenceKey.substring(0, 50) + '...' +
        ' summary=' + e.summary.substring(0, 40));
});

var gsrdUniqueKeys = Object.keys(gsrdKeySet).length;
console.log('Unique keys: ' + gsrdUniqueKeys + ' / ' + gsrdEvents.length);

// 2. Check that date-shifted instance exists with correct key
var shifted = gsrdEvents.find(function(e) {
    return e.recurrenceId === '20250915T160500';
});
if (shifted) {
    console.log('\n--- Date-shifted instance (9/15 -> 9/16) ---');
    console.log('  recurrenceId: ' + shifted.recurrenceId);
    console.log('  DTSTART:      ' + shifted.start.toISOString());
    console.log('  summary:      ' + shifted.summary);
    console.log('  key:          ' + shifted.recurrenceKey.substring(0, 60) + '...');
} else {
    console.log('\nERROR: Date-shifted 9/15 instance not found!');
}

// 3. Check the 20260126 instance
var jan26 = gsrdEvents.find(function(e) {
    return e.recurrenceId === '20260126T160500';
});
if (jan26) {
    console.log('\n--- Jan 26 instance (the reported missing event) ---');
    console.log('  recurrenceId: ' + jan26.recurrenceId);
    console.log('  DTSTART:      ' + jan26.start.toISOString());
    console.log('  key:          ' + jan26.recurrenceKey.substring(0, 60) + '...');
} else {
    console.log('\nERROR: Jan 26 instance not found!');
}

// 4. Overall key uniqueness
var allKeys = {};
var dupCount = 0;
events.forEach(function(e) {
    if (allKeys[e.recurrenceKey]) {
        dupCount++;
    }
    allKeys[e.recurrenceKey] = (allKeys[e.recurrenceKey] || 0) + 1;
});

console.log('\n--- Overall uniqueness ---');
console.log('Total events: ' + events.length);
console.log('Unique keys:  ' + Object.keys(allKeys).length);
if (dupCount > 0) {
    console.log('WARNING: ' + dupCount + ' duplicate keys found');
    Object.keys(allKeys).forEach(function(k) {
        if (allKeys[k] > 1) {
            console.log('  dup (' + allKeys[k] + 'x): ' + k.substring(0, 70) + '...');
        }
    });
} else {
    console.log('OK: All keys are unique');
}

// 5. Summary
// Note: 1 duplicate key is expected — the ICS source data contains two
// identical VEVENTs for "[Shokunin] Bi-weekly Leadership + Team Leads"
// with the same UID and RECURRENCE-ID 20250822T080000 (Outlook export
// artifact). The second overwrites the first, which is correct.
var maxAcceptableDups = 1;
var passed = gsrdEvents.length >= 17 && gsrdUniqueKeys === gsrdEvents.length && jan26 && shifted && dupCount <= maxAcceptableDups;
console.log('\n' + (passed ? 'PASS' : 'FAIL'));
process.exit(passed ? 0 : 1);
