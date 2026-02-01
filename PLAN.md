# Autoapply — Plan & Roadmap

**Current state vs. what’s next.** This doc is the single source of truth for “what we have” and “what to implement next.”

---

## 1. ✅ What We Have (Implemented)

### 1.1 ⚙️ Config & Profile

- **Config:** `~/.autoapply/config.json` — load/save/default, schema migration, validation.
- **Profile:** Full name, email, phone, location, work auth, sponsorship, prior employment, referral source, state, LinkedIn/website/GitHub, EEO (gender, LGBTQ, race, veteran, disability). Stored in config.
- **Preferences:** Titles, locations, keywords, exclude-keywords, experience, remote/hybrid. Stored in config.
- **Resume vault:** Add PDFs with label/default; paths and SHA256 stored in config; assets copied under `~/.autoapply/assets/`.

### 1.2 🔍 Discovery (Job Fetching)

- **Company registry:** JSON array `{ name, ats, slug }`. Supported ATS: **greenhouse**, **lever**, **ashby**.
- **Fetchers:** Greenhouse (boards API), Lever (API), Ashby (API). Jobs written to `jobs.json`; optional `--filtered` runs preference filter and writes `filtered_jobs.json`.
- **Filter:** By title, location, keywords, exclude-keywords, experience, remote/hybrid.

### 1.3 💾 Storage

- **FileJobStore:** `jobs.json`, `filtered_jobs.json` under dataDir. Load/upsert/write.
- **InMemoryJobRepo:** Tracks applied URLs only for the current run; **not persisted** across runs.

### 1.4 🤖 Automation

- **Playwright session:** Persistent Chrome profile (`~/.autoapply/chrome-profile`), new page/tab helpers, `locateApplyTarget` for Indeed-style “Apply” detection.
- **Run artifacts:** Each run has a directory under `~/.autoapply/runs/<runId>/` with manifest, JSONL log, screenshots.

### 1.5 📝 Forms (Greenhouse)

- **GreenhouseFormEngine:**  
  - **mapAndFill:** Field hint detection (label, aria, placeholder, name, id), mapping to profile/vault fields (name, email, phone, location, work auth, sponsorship, EEO, LinkedIn, website, GitHub, etc.), fill inputs/selects/radio/checkbox; file input marked for resume (actual file upload done in core).  
  - **answerScreening:** Clicks through screening questions using profile (selector-based).  
  - **detectSubmitState:** Finds submit CTA, returns `ready-to-submit` | `incomplete` | `blocked` + policy pass/fail; **does not click submit**.
- **Resume upload:** Resume file is set on file inputs in Greenhouse flow (in core/orchestrator path that uses this engine).

### 1.6 📤 Apply Flow (Greenhouse Only)

- **greenhouseApply.ts:** For each job (from filtered list or single URL): open apply URL → find and click “Apply” CTA → wait for form → **mapAndFill** → **answerScreening** → **detectSubmitState** → log result and screenshot. **Always dry-run:** never clicks the final Submit button; returns status `dry-run` with submit state (ready/incomplete/blocked).
- **CLI `apply`:** Uses GreenhouseFormEngine; supports `--limit`, `--url` (single job), `--keep-open`, `--pause-on-verification`. All attempts are dry-runs.

### 1.7 🏢 Indeed Board (Orchestrator)

- **Indeed connector:**  
  - **search:** Builds Indeed search URL from preferences, opens in browser, waits for manual verification (e.g. Cloudflare), scrapes listing links and metadata into `JobListing[]`.  
  - **apply:** Opens listing URL → finds apply target (inline vs external) → if external, logs and skips; if inline, uses **IndeedFormEngine** for fill (no full submit flow; flow is connector-specific).
- **Orchestrator:** Takes one board (e.g. indeed), runs connector.search → for each listing checks InMemoryJobRepo.hasApplied → connector.apply. **InMemoryJobRepo** means “already applied” is only for the current run.
- **CLI `run`:** Board=indeed, optional `--dry-run`, `--max-applications`. Uses IndeedFormEngine and InMemoryJobRepo.

### 1.8 ⌨️ CLI

- **Commands:** init, resume add, profile set/info, prefs set, config show, discover, jobs, apply (greenhouse dry-run), run (indeed orchestrator), probe (Indeed search + apply target debugging), history, status.
- **status:** Always prints “No active run” (no live run state).

### 1.9 📋 Logging & History

- **Run logger:** JSONL events per run (attempt, skip, error, submit-detection, etc.).
- **history:** List runs by time; `--run <runId> --verbose` shows per-listing status (dry-run/skipped/failed), submit state, policy, screenshots.

---

## 2. ❌ Gaps / Not Implemented (Explicit)

- **Submit button (Greenhouse):** Flow stops at **detectSubmitState**. No code path that actually clicks “Submit application” to complete an application.
- **Real apply vs dry-run flag:** Greenhouse apply is **always** dry-run. No `--no-dry-run` or equivalent to perform real submit.
- **NullFormEngine.detectSubmitState:** Returns `blocked` + `"not implemented"`; used only where a form engine isn’t wired (e.g. generic engine interface).
- **Persistence of “already applied”:** InMemoryJobRepo is in-memory only. After restart, the same jobs can be applied again. No DB or file-backed “applied URLs” for Indeed or Greenhouse.
- **Lever / Ashby apply:** Discovery fetches Lever and Ashby jobs and they appear in `filtered_jobs.json`, but **apply** only runs for `ats === "greenhouse"`. No Lever or Ashby form engines or apply flows.
- **status command:** No connection to a running process; always “No active run.”

---

## 3. 🎯 What to Implement Next (Prioritized)

### 🔴 P0 — Core product

1. **Greenhouse real submit (optional)**  
   - Add a flag (e.g. `--submit` or `dryRun: false` in apply context) that, when submit state is `ready-to-submit` and policy is pass, **clicks the Submit button** and then records status as `submitted` (or failed if something breaks).  
   - Keep default behavior as dry-run.  
   - **Risks:** CAPTCHA, consent checkboxes, or post-submit screens may require extra handling.

2. **Persistent “already applied” store**  
   - Replace or complement InMemoryJobRepo with a persistent store (e.g. SQLite or a JSON file keyed by applyUrl or job id) so that:  
     - Greenhouse apply (and later Indeed) can skip jobs already applied in a previous run.  
   - CLI: optional `--reset-applied` or similar to clear state for re-runs.

### 🟠 P1 — Quality & safety

3. **Confirm before real submit**  
   - For real Greenhouse submit: require explicit confirmation (e.g. `--confirm-submit` or interactive “Apply to N jobs? (y/n)”) so users don’t accidentally submit.

4. **GreenhouseFormEngine edge cases**  
   - Cover letter / long-form text: currently skipped; optionally allow a default or template.  
   - Recaptcha: detected and skipped; no automation; document that user may need to complete manually in a “semi-automated” run.  
   - Company-specific required fields: extend field mapping or allow a small per-company override (e.g. optional JSON) if needed.

5. **Run status (optional)**  
   - If runs are ever backgrounded or driven by another process: persist “running” state (e.g. PID or lock file) so `status` can report “Run X in progress.” Not required for current single-process CLI.

### 🟡 P2 — More ATS & UX

6. **Lever apply flow**  
   - Lever apply URLs and job structure are known from discovery. Implement LeverFormEngine (or Lever-specific steps) + a small apply path (open apply URL → fill → detect submit state → optional submit), and wire `apply --ats lever` to use it.

7. **Ashby apply flow**  
   - Same idea as Lever: AshbyFormEngine + apply path, wire `apply --ats ashby`. May require probing a few Ashby job pages to see form structure.

8. **Indeed apply flow completion**  
   - Indeed connector already detects external vs inline apply. Flesh out inline apply (form fill + optional submit) using IndeedFormEngine so `run --board indeed` can complete applications, not only discover and skip.

9. **Better resume handling**  
   - Multiple resumes: already in config; ensure “default” is used everywhere and consider `--resume <label>` in apply/run.  
   - Optional: parse job description and pick resume by keyword match (future).

### 🟢 P3 — Nice to have

10. **Configurable company registry path**  
    - Already have `--registry` for discover; document and consider defaulting to `./companies.json` or `~/.autoapply/companies.json` so it’s one less flag.

11. **Rate limiting / backoff**  
    - For discovery (Greenhouse/Lever/Ashby) and for apply loops: add simple delay or exponential backoff to avoid hammering APIs/sites.

12. **Tests**  
    - Unit tests for filterJobs, config validate/migrate, form field mapping (with mocked DOM or fixture HTML).  
    - Integration: one Greenhouse apply page fixture and run apply in dry-run to verify fill + detectSubmitState.

---

## 4. 📊 Summary Table

| Area              | Has now ✅                                   | Next ⏳ |
|-------------------|-----------------------------------------------|--------|
| ⚙️ Config / profile | Full config, profile, prefs, resume vault     | —      |
| 🔍 Discovery       | Greenhouse, Lever, Ashby fetch + filter       | —      |
| 💾 Storage         | FileJobStore; InMemoryJobRepo (per run)       | Persistent “applied” store (🔴 P0) |
| 📤 Greenhouse apply | Dry-run only: fill + detect submit, no click  | Real submit behind flag + confirm (🔴 P0, 🟠 P1) |
| 🏢 Indeed          | Search + apply target detection; inline skip  | Complete inline apply + optional submit (🟡 P2) |
| Lever / Ashby      | Discovery only                                | Apply flows (🟡 P2) |
| status             | Static “No active run”                        | Optional: running run state (🟠 P1) |
| Tests              | None                                         | Unit + one integration dry-run (🟢 P3) |

---

## 5. 📌 Doc ownership

Keep this file updated as you ship P0/P1 items and reprioritize. When a “next” item is done, move it into “What we have” and adjust the table.
