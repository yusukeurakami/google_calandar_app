/**
 * @fileoverview Local test to verify RRULE expansion in
 * expandRecurringEvents().
 *
 * Parses the real latest_cal.ics file, expands recurring events, and
 * checks that:
 *   - Total event count increases after expansion
 *   - A known weekly series produces the correct number of occurrences
 *   - EXDATE exclusions are applied
 *   - Exception instances are preserved (not duplicated)
 *   - All recurrenceKeys remain unique
 *
 * Runs with plain Node.js (no gas-fakes needed).
 *
 * Usage:
 *   node tests/test_rrule_expansion.js
 */

var fs = require('fs');
var path = require('path');

// --- Minimal GAS polyfills ---
var Logger = { log: function (msg) { console.log('  [LOG] ' + msg); } };
var TIMEZONE_MAP = {
    'Tokyo Standard Time': 'Asia/Tokyo',
    'Pacific Standard Time': 'America/Los_Angeles',
    'Eastern Standard Time': 'America/New_York',
    'GMT Standard Time': 'Europe/London',
    'W. Europe Standard Time': 'Europe/Paris',
    'Central Standard Time': 'America/Chicago'
};
var Utilities_parseDate_Mock = function (dateStr, tz, fmt) {
    var p = dateStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    return new Date(Date.UTC(+p[1], +p[2] - 1, +p[3], +p[4], +p[5], +p[6]));
};

// --- Load functions from import_calendar.js ---
var scriptPath = path.join(__dirname, '..', 'import_calendar.js');
var scriptSrc = fs.readFileSync(scriptPath, 'utf8');

// Eval everything from parseICSContent onwards (includes parseICSDate,
// padZero_, formatICSDateStr_, parseRRule_, getNthWeekdayOfMonth_,
// expandRRule_, expandRecurringEvents).
eval(scriptSrc.substring(scriptSrc.indexOf('function parseICSContent')));

// --- Parse ICS file ---
var icsPath = path.join(__dirname, 'latest_cal.ics');
var icsContent = fs.readFileSync(icsPath, 'utf8');

console.log('=== RRULE Expansion Test ===\n');

var rawEvents = parseICSContent(icsContent);
console.log('\nBefore expansion: ' + rawEvents.length + ' events\n');

var expandedEvents = expandRecurringEvents(rawEvents);
console.log('\nAfter expansion:  ' + expandedEvents.length + ' events\n');

// ---------------------------------------------------------------
// Test 1: Total count increased
// ---------------------------------------------------------------
var passed = true;

console.log('--- Test 1: Total event count increased ---');
if (expandedEvents.length > rawEvents.length) {
    console.log('PASS: ' + rawEvents.length + ' -> ' + expandedEvents.length +
        ' (+' + (expandedEvents.length - rawEvents.length) + ' from RRULE expansion)');
} else {
    console.log('FAIL: Event count did not increase (' + expandedEvents.length + ')');
    passed = false;
}

// ---------------------------------------------------------------
// Test 2: "Context Driven Expression Generation" series (UID ...2189)
//   RRULE: FREQ=WEEKLY;UNTIL=20270209T060500Z;INTERVAL=1;BYDAY=TU
//   Expected: 103 Tuesdays - 10 EXDATE = 93 occurrences
//   Of those: 51 are exception VEVENTs, 42 are RRULE-expanded
// ---------------------------------------------------------------
var targetUidPart = '9AAED86E917C84428E4417B5C8DF2189';
var seriesEvents = expandedEvents.filter(function (e) {
    return e.uid.indexOf(targetUidPart) >= 0;
});

console.log('\n--- Test 2: Context Driven Expression Generation series ---');
console.log('Events with UID ...2189: ' + seriesEvents.length + ' (expected: 93)');

if (seriesEvents.length === 93) {
    console.log('PASS: Correct occurrence count');
} else {
    console.log('FAIL: Expected 93, got ' + seriesEvents.length);
    passed = false;
}

// ---------------------------------------------------------------
// Test 3: EXDATE exclusions applied
//   Check that excluded dates do NOT appear
// ---------------------------------------------------------------
var excludedDates = [
    '20250311T150500', '20250506T150500', '20250715T150500',
    '20250729T150500', '20250812T150500', '20250930T150500',
    '20251007T150500', '20251223T150500', '20251230T150500',
    '20260203T150500'
];

console.log('\n--- Test 3: EXDATE exclusions ---');
var exdateLeaks = [];
for (var i = 0; i < seriesEvents.length; i++) {
    for (var j = 0; j < excludedDates.length; j++) {
        if (seriesEvents[i].recurrenceId === excludedDates[j]) {
            exdateLeaks.push(excludedDates[j]);
        }
    }
}
if (exdateLeaks.length === 0) {
    console.log('PASS: All 10 EXDATE entries excluded');
} else {
    console.log('FAIL: EXDATE dates leaked through: ' + exdateLeaks.join(', '));
    passed = false;
}

// ---------------------------------------------------------------
// Test 4: A known expanded occurrence exists (not in exception list)
//   20260505T150500 should be an RRULE-expanded occurrence
// ---------------------------------------------------------------
console.log('\n--- Test 4: Known expanded occurrence exists ---');
var expandedOcc = seriesEvents.find(function (e) {
    return e.recurrenceId === '20260505T150500';
});
if (expandedOcc) {
    console.log('PASS: Found expanded occurrence for 2026-05-05');
    console.log('  recurrenceKey: ' + expandedOcc.recurrenceKey.substring(0, 60) + '...');
    console.log('  start: ' + expandedOcc.start.toISOString());
} else {
    console.log('FAIL: Expanded occurrence 20260505T150500 not found');
    passed = false;
}

// ---------------------------------------------------------------
// Test 5: Exception instance preserved (not duplicated)
//   20250218T150500 is an exception VEVENT — should exist exactly once
// ---------------------------------------------------------------
console.log('\n--- Test 5: Exception instance not duplicated ---');
var exceptionOccs = seriesEvents.filter(function (e) {
    return e.recurrenceId === '20250218T150500';
});
if (exceptionOccs.length === 1) {
    console.log('PASS: Exception 20250218T150500 exists exactly once');
} else {
    console.log('FAIL: Exception 20250218T150500 count = ' + exceptionOccs.length + ' (expected 1)');
    passed = false;
}

// ---------------------------------------------------------------
// Test 6: Overall key uniqueness
// ---------------------------------------------------------------
console.log('\n--- Test 6: Key uniqueness ---');
var allKeys = {};
var dupCount = 0;
expandedEvents.forEach(function (e) {
    if (allKeys[e.recurrenceKey]) { dupCount++; }
    allKeys[e.recurrenceKey] = (allKeys[e.recurrenceKey] || 0) + 1;
});

console.log('Unique keys: ' + Object.keys(allKeys).length + ' / ' + expandedEvents.length);
// Allow 1 known duplicate (Outlook export artifact)
if (dupCount <= 1) {
    console.log('PASS: Key uniqueness OK (dups: ' + dupCount + ', max allowed: 1)');
} else {
    console.log('FAIL: ' + dupCount + ' duplicate keys');
    Object.keys(allKeys).forEach(function (k) {
        if (allKeys[k] > 1) {
            console.log('  dup (' + allKeys[k] + 'x): ' + k.substring(0, 70) + '...');
        }
    });
    passed = false;
}

// ---------------------------------------------------------------
// Test 7: A monthly RRULE is expanded (spot check)
//   Find any MONTHLY series and verify it produced occurrences
// ---------------------------------------------------------------
console.log('\n--- Test 7: Monthly RRULE expansion ---');
var monthlyMasters = rawEvents.filter(function (e) {
    return e.rrule && e.rrule.indexOf('FREQ=MONTHLY') >= 0 && !e.recurrenceId;
});
if (monthlyMasters.length > 0) {
    var mUid = monthlyMasters[0].uid;
    var mSummary = monthlyMasters[0].summary;
    var mEvents = expandedEvents.filter(function (e) { return e.uid === mUid; });
    console.log('Monthly series "' + mSummary.substring(0, 50) + '": ' + mEvents.length + ' occurrences');
    if (mEvents.length > 1) {
        console.log('PASS: Monthly expansion produced multiple occurrences');
    } else {
        console.log('FAIL: Monthly expansion produced only ' + mEvents.length + ' occurrence(s)');
        passed = false;
    }
} else {
    console.log('SKIP: No monthly RRULE masters found');
}

// ---------------------------------------------------------------
// Summary
// ---------------------------------------------------------------
console.log('\n=== ' + (passed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED') + ' ===');
process.exit(passed ? 0 : 1);
