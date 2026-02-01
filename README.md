# Autoapply

CLI job auto-apply tool. Discovers jobs from company registries (Greenhouse, Lever, Ashby), filters by your preferences, and automates applications via Playwright (Indeed, Greenhouse forms).

---

## Folder structure

```
Autoapply/
├── src/                    # TypeScript source
│   ├── index.ts            # Entry: runs CLI
│   ├── cli/
│   │   └── run.ts          # CLI commands and handlers
│   ├── config/
│   │   ├── index.ts        # Load/save/default config (~/.autoapply/config.json)
│   │   ├── migrate.ts      # Config schema migrations
│   │   └── validate.ts     # Config validation
│   ├── assets/
│   │   ├── index.ts        # Asset helpers
│   │   └── vault.ts        # Resume vault (add, list, default)
│   ├── automation/
│   │   ├── index.ts
│   │   ├── playwright.ts   # Playwright session/browser
│   │   └── session.ts      # Page/session helpers
│   ├── connectors/
│   │   ├── index.ts        # Connector registry
│   │   └── indeed/
│   │       └── indeedConnector.ts
│   ├── core/
│   │   ├── greenhouseApply.ts  # Greenhouse apply flow (dry-run)
│   │   └── orchestrator.ts    # Run orchestration (Indeed etc.)
│   ├── discovery/
│   │   ├── index.ts        # discoverJobs from company registry
│   │   ├── greenhouseFetcher.ts
│   │   ├── leverFetcher.ts
│   │   ├── ashbyFetcher.ts
│   │   └── filterJobs.ts  # Filter by preferences
│   ├── forms/
│   │   ├── index.ts
│   │   ├── engine.ts       # Form fill abstraction
│   │   ├── greenhouseFormEngine.ts
│   │   └── indeedFormEngine.ts
│   ├── logging/
│   │   ├── index.ts
│   │   ├── logger.ts
│   │   └── runLogger.ts   # Per-run JSONL logs
│   ├── storage/
│   │   ├── jobStore.ts     # FileJobStore (jobs.json, filtered_jobs.json)
│   │   └── repositories.ts
│   └── types/
│       ├── boards.ts       # SearchCriteria
│       ├── context.ts      # UserProfile, ResumeAsset, run context
│       └── jobs.ts         # JobRecord, CompanyRegistryEntry
├── dist/                   # Compiled JS (from `npm run build`)
├── companies.json         # Company registry: { name, ats, slug }
├── package.json
└── tsconfig.json
```

Config and data live under `~/.autoapply/` (dataDir): `config.json`, `assets/`, `jobs.json`, `filtered_jobs.json`, `runs/<runId>/`.

---

## Commands

### Setup / one-time

```bash
# Install deps
npm install

# Build (TypeScript → dist/)
npm run build

# Run CLI (after build)
npm start -- <command> [args]
# Or: node dist/index.js <command> [args]
```

### CLI commands

| Command | Description |
|--------|-------------|
| `init` | Create default config at `~/.autoapply/config.json` |
| `resume add <path> [--label <name>] [--default]` | Add resume to vault; optional label and set as default |
| `profile set [flags]` | Set profile (see flags below) |
| `profile info` | Print Chrome profile paths (userDataDir, profileDir) |
| `prefs set [flags]` | Set job search preferences (titles, locations, keywords, etc.) |
| `config show` | Print config (sensitive values redacted) |
| `discover [--registry <path>] [--filtered]` | Fetch jobs from company registry; `--filtered` also filters by prefs and writes `filtered_jobs.json` |
| `jobs [--limit N]` | List filtered jobs (default limit 20). Run `discover --filtered` first. |
| `apply [--ats greenhouse] [--limit N] [--url <jobUrl>] [--keep-open] [--pause-on-verification]` | Greenhouse dry-run apply (from filtered jobs or single `--url`) |
| `run [--board indeed] [--dry-run] [--max-applications N]` | Run orchestrator (Indeed board, optional dry-run and cap) |
| `probe [--url <searchUrl>] [--verify-wait <seconds>]` | Open Indeed search (or custom URL), probe job cards and apply targets |
| `history [--limit N] [--run <runId>] [--verbose]` | List runs or show one run’s details |
| `status` | Placeholder (no active run state yet) |

**Profile flags (e.g. `profile set`):**  
`--full-name`, `--email`, `--phone`, `--location`, `--work-auth`, `--sponsorship`, `--prior-employment`, `--referral-source`, `--state`, `--linkedin`, `--website`, `--github`, `--gender`, `--lgbtq`, `--race`, `--veteran`, `--disability`

**Prefs flags (e.g. `prefs set`):**  
`--title`, `--location`, `--keyword`, `--exclude-keyword`, `--experience` (each can be passed multiple times or comma-separated), `--remote` / `--no-remote`, `--hybrid` / `--no-hybrid`

---

## Typical workflow

1. **One-time setup**
   ```bash
   npm run build
   npm start -- init
   npm start -- resume add ./path/to/resume.pdf [--default]
   npm start -- profile set --full-name "Jane Doe" --email "jane@example.com" --phone "+1..."
   npm start -- prefs set --title "Software Engineer" --location "San Francisco" --remote
   ```

2. **Discover and filter jobs**
   ```bash
   npm start -- discover --registry ./companies.json --filtered
   npm start -- jobs --limit 30
   ```

3. **Apply (Greenhouse dry-run)**
   ```bash
   npm start -- apply --ats greenhouse --limit 10
   # Or single URL:
   npm start -- apply --url "https://boards.greenhouse.io/company/jobs/123"
   ```

4. **Indeed run (orchestrator)**
   ```bash
   npm start -- run --board indeed --dry-run --max-applications 5
   ```

5. **Inspect runs**
   ```bash
   npm start -- history --limit 5
   npm start -- history --run <runId> --verbose
   ```

---

## Company registry

`companies.json` (or `--registry <path>`) is a JSON array of:

```json
{ "name": "Stripe", "ats": "greenhouse", "slug": "stripe" }
```

Supported `ats`: `greenhouse`, `lever`, `ashby`. Discovery fetches job listings and apply URLs; `apply` currently supports **Greenhouse** only.

---

## Requirements

- Node.js (ES2020)
- Playwright (browsers installed via `npx playwright install` if needed)
- Chrome not running when using the persistent profile (or you’ll get a lock error)
