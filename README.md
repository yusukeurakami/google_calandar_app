# Google Calendar ICS Sync — GAS App

A Google Apps Script application that loads `.ics` files from Google Drive and updates Google Calendar accordingly.

## Quick Start 🚀

Follow these steps to deploy and run the script on your Google account.

### 1. Install Clasp
If you haven't already, install the Google Apps Script CLI:
```bash
npm install -g @google/clasp
```

### 2. Login & Create Project
```bash
clasp login
clasp create --title "Google Calendar Sync" --type standalone
```

### 3. Push Code
Upload the script files to Google Apps Script:
```bash
clasp push
```

### 4. Run the Script
Open the project in your browser:
```bash
clasp open-script
```
- In the Apps Script editor, select `importICSFile` from the function dropdown.
- Click **Run**.
- Grant the necessary permissions when prompted.

---

## Features

- **ICS Import**: Parses `.ics` files from Google Drive.
- **Smart Sync**:
  - Creates new events.
  - Updates existing events (if changed).
  - Deletes orphaned events (if removed from ICS).
- **Timezone Support**: Automatically maps Windows-style timezones (e.g., `Tokyo Standard Time`, `Pacific Standard Time`) to IANA timezones (e.g., `Asia/Tokyo`) to ensure correct event times on Google Calendar.


## Development Environment

This project uses a **local-first GAS development** workflow powered by:

| Tool | Purpose |
|---|---|
| [gas-fakes](https://github.com/brucemcpherson/gas-fakes) | Emulates the GAS runtime locally (DriveApp, CalendarApp, etc.) |
| [clasp](https://github.com/google/clasp) | Deploys local code to Google Apps Script |
| [gcloud CLI](https://cloud.google.com/sdk/docs/install) | Authenticates with Google Cloud APIs |
| [MCP](https://modelcontextprotocol.io/) | Exposes gas-fakes & clasp as tools for AI agents in Antigravity |

## Prerequisites

- **Node.js** (v20+)
- **Google Account** with access to Drive and Calendar
- **GCP Project** — create one at [console.cloud.google.com](https://console.cloud.google.com/projectcreate)

## Setup from Scratch

### 1. Install gcloud CLI

Download and install the standalone archive (no `sudo` required):

```bash
curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz
tar -xf google-cloud-cli-linux-x86_64.tar.gz
./google-cloud-sdk/install.sh -q
rm google-cloud-cli-linux-x86_64.tar.gz
```

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
if [ -f '<project_dir>/google-cloud-sdk/path.zsh.inc' ]; then
  . '<project_dir>/google-cloud-sdk/path.zsh.inc'
fi
if [ -f '<project_dir>/google-cloud-sdk/completion.zsh.inc' ]; then
  . '<project_dir>/google-cloud-sdk/completion.zsh.inc'
fi
```

### 2. Install gas-fakes and clasp

```bash
npm install -g @mcpher/gas-fakes
npm install -g @google/clasp
```

### 3. Initialize gas-fakes

> [!CAUTION]
> **The default `--auth-type` is `dwd` (Domain-Wide Delegation)**, which is designed for Google Workspace orgs and requires admin setup. For personal accounts, you **must** use `--auth-type adc`:

```bash
gas-fakes init --auth-type adc
```

The interactive wizard will ask for:

| Prompt | What to enter |
|---|---|
| `.env` file | Select existing or create new |
| GCP Project ID | Your project ID (e.g. `warm-axle-487108-e7`) |
| Test Drive file ID | Optional — press Enter to skip |
| Extra scopes | Select **Workspace resources** (Drive). See note below about Calendar. |
| OAuth client credentials | Optional — press Enter to skip |
| Quiet mode | `off` (default) |
| Logging destination | `CONSOLE` (default) |
| Storage type | `FILE` (default) |

> [!WARNING]
> **Sensitive scopes (Calendar, Gmail) require an OAuth client credential file** if selected during `init`. To avoid this blocker, skip the Calendar scope during `init` and **add it manually** to `.env` afterwards:
>
> ```bash
> EXTRA_SCOPES="https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/calendar"
> ```

> [!IMPORTANT]
> **`appsscript.json` must be valid JSON before running `init`.** If the file is empty (0 bytes), `gas-fakes init` will crash with `SyntaxError: Unexpected end of JSON input`. Create a valid manifest first:
>
> ```json
> {
>   "timeZone": "Asia/Tokyo",
>   "dependencies": {},
>   "exceptionLogging": "STACKDRIVER",
>   "runtimeVersion": "V8",
>   "oauthScopes": [
>     "https://www.googleapis.com/auth/drive.readonly",
>     "https://www.googleapis.com/auth/calendar"
>   ]
> }
> ```

### 4. Authenticate

```bash
gas-fakes auth
```

This runs two sequential `gcloud` authentication flows:

1. **gcloud auth login** — grants general access (opens browser)
2. **gcloud auth application-default login** — grants ADC credentials with your selected scopes (opens browser again)

> [!WARNING]
> **You must check ALL permission boxes** in both consent screens. If you skip the `cloud-platform` scope, the auth will fail with:
> `ERROR: cloud-platform scope is required but not consented.`
>
> If you see **"This app is blocked"** (because Calendar is a sensitive scope on the default client ID), click **Advanced → Go to App (unsafe)** to proceed. This is safe for personal development.

### 5. Enable Google Cloud APIs

```bash
gas-fakes enableAPIs
```

This enables: Drive, Sheets, Forms, Docs, Gmail, Logging, and Calendar APIs on your GCP project.

### 6. Verify Setup

```bash
gas-fakes -s "const rootFolder = DriveApp.getRootFolder(); const rootFolderName = rootFolder.getName(); console.log(rootFolderName);"
```

Expected output: `My Drive`

### 7. Configure MCP (for Antigravity)

The `mcp_config.json` in `~/.gemini/antigravity/` registers gas-fakes and clasp as MCP servers:

```json
{
  "mcpServers": {
    "gas-fakes": {
      "command": "gas-fakes",
      "args": ["mcp"],
      "disabled": false,
      "disabledTools": []
    },
    "clasp": {
      "command": "clasp",
      "args": ["mcp"]
    }
  }
}
```

This allows the AI agent in Antigravity to autonomously generate, test, and deploy GAS code.

## Project Structure

```
google_calandar_app/
├── .env                 # gas-fakes configuration (scopes, project ID, auth type)
├── appsscript.json      # GAS manifest (timezone, scopes, runtime version)
├── gasfakes.json        # Auto-generated gas-fakes runtime settings
├── google-cloud-sdk/    # gcloud CLI installation
└── README.md
```

## Workflow

```
 Edit locally (.js)
    │
    ▼
 Test with gas-fakes     ←── gas-fakes -f <file.js>
    │
    ▼
 Deploy with clasp       ←── clasp push
    │
    ▼
 Run on Google           ←── clasp open (web editor)
```

## References

- [gas-fakes Getting Started](https://github.com/brucemcpherson/gas-fakes/blob/main/GETTING_STARTED.md)
- [clasp Documentation](https://github.com/google/clasp)
- [Next-Gen GAS Development with Antigravity (Medium)](https://medium.com/google-cloud/next-generation-google-apps-script-development-leveraging-antigravity-and-gemini-3-0-c4d5affbc1a8)
- [VSCode + clasp Setup (Zenn, Japanese)](https://zenn.dev/cordelia/articles/3107aaf8b7a3d6)
