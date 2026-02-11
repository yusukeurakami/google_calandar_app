# 2026-02-11 — Initial Project Setup

## Summary

Set up the Google Apps Script local development environment for the ICS-to-Calendar sync project.

## Changes

### New Files

- **`README.md`** — Comprehensive setup documentation with step-by-step instructions and gotchas discovered during installation.
- **`appsscript.json`** — GAS manifest configured for `Asia/Tokyo` timezone with `drive.readonly` and `calendar` OAuth scopes.
- **`.env`** — gas-fakes configuration with GCP project `warm-axle-487108-e7`, ADC auth type, Drive + Calendar scopes.
- **`gasfakes.json`** — Auto-generated gas-fakes runtime settings.
- **`mcp_config.json`** (in `~/.gemini/antigravity/`) — MCP server configuration for gas-fakes and clasp.

### Installed Tools

- **gcloud CLI** v556.0.0 — installed locally in `google-cloud-sdk/`
- **@mcpher/gas-fakes** v2.0.6 — GAS runtime emulator (global npm)
- **@google/clasp** — GAS deployment CLI (global npm)

## Gotchas Discovered

1. **`gas-fakes init` defaults to `--auth-type dwd`** (Domain-Wide Delegation), not `adc`. Personal accounts must use `--auth-type adc`.
2. **Empty `appsscript.json` crashes `gas-fakes init`** with `SyntaxError: Unexpected end of JSON input` — the file must contain valid JSON.
3. **Selecting sensitive scopes (Calendar) during `init` requires an OAuth client credential file** — workaround is to skip during init and add manually to `.env`.
4. **All permission checkboxes must be selected** in the browser consent screen or `gcloud auth application-default login` fails.
