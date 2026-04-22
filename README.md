# Sentry Auto-Triage: Autonomous Construct Agent Workplace

An intelligent, fully autonomous business workflow agent built for the **CONSTRUCT × Techfluence 2026 App Store Bounty Track**.

This is not a simple notification wrapper or a chat bot. It is a true, persistent, autonomous edge application running on Cloudflare Workers that equips a **Construct OS Agent** to handle the entire lifecycle of an incident exactly like a Human DevOps/SRE Engineer would.

---

## 🏆 Bounty Submission Details

### 1. Business Impact: Real, End-to-End Automation
When a Sentry alert fires, resolving it requires context switching across 4-5 different web apps, taking 15-30 minutes of human time. This app completely eliminates that operational overhead:
1. **Listens (Sentry):** Receives incident webhooks natively.
2. **Analyzes (Intelligent Agent):** Parses the stack trace, identifies the precise culprit file and line, and calculates an algorithmic priority score (e.g. fatal + spike = P0, warning + old = P3).
3. **Investigates (GitHub):** Executes a GraphQL git-blame on the exact culprit line to find the offending commit message and author.
4. **Documents (Linear):** Formats a rich Markdown ticket containing the stack trace, regression evidence, and code blame, directly assigning priority natively.
5. **Alerts (Slack):** Posts a clean, actionable summary to the engineering team's `#incidents` channel with ticket links attached.

### 2. Workflow Novelty
Our application implements complex logic typically missing from simple AI agents:
- **Stateful Deduplication:** Ensures that an incident is only triaged once an hour to protect the team from alert fatigue and duplicate tickets.
- **Micro-Analysis:** Sentry provides long messy traces; our `triage_issue` tool filters out framework internals and focuses strictly on the precise application code that threw the error.
- **Git Blame Accuracy:** The agent executes a GraphQL call into GitHub to find the actual code owner of the exact line, not just whoever touched the file last.

### 3. Technical Quality
Built natively on **Cloudflare Workers** using `@construct-computer/app-sdk`.
- Completely Serverless & Edge Optimized.
- Bypasses slow agent prompting by performing data manipulation natively in TypeScript edge functions before returning pure, actionable data to the Construct LLM agent.

---

## 🌐 Live Deployment

The app is deployed LIVE on Cloudflare Workers:

```
https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev
```

Open this in your browser to see the App UI directly.

---

## 👨‍⚖️ FOR THE JUDGES: How to Test

There are **two ways** to test — with or without credentials.

---

### ✅ Option 1 — No Credentials Required (Instant curl tests)

All tools are exposed via the **MCP JSON-RPC protocol** at the `/mcp` endpoint.

> **Windows users:** Replace `'` with `"` and escape inner quotes accordingly, or use Git Bash / WSL.

---

#### 🔵 Health Check
Verify the worker is live:
```bash
curl https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/health
```
Expected: `ok`

---

#### 🔵 List All 5 Tools
See all registered tools and their input schemas:
```bash
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
Expected: JSON list of all 5 tools with descriptions.

---

#### 🔴 Tool 1: `triage_issue`
Parses a Sentry issue, assigns P0-P3 priority, detects regression — all in one call:
```bash
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"triage_issue","arguments":{"issue_json":"{\"level\":\"fatal\",\"count\":200,\"userCount\":80,\"title\":\"TypeError: Cannot read properties of null\",\"firstSeen\":\"2026-04-22T00:00:00Z\",\"lastSeen\":\"2026-04-22T01:00:00Z\"}","event_json":"{}"}},"id":1}'
```
Expected: `priority: P0`, `severityScore: 210`, `action: "Page on-call immediately. All hands on deck."`, `isSpike: true`

---

#### 🟡 Tool 2: `blame_code_line`
Uses GitHub GraphQL to find the exact author of a culprit line. Replace `YOUR_GHP_TOKEN` with a real GitHub token:
```bash
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"blame_code_line","arguments":{"repo":"Botcoder757/sentry-triage-final","file_path":"server.ts","line_number":10,"github_token":"YOUR_GHP_TOKEN","branch":"main"}},"id":2}'
```
Expected: author name, email, commit SHA, commit message for line 10 of server.ts.

---

#### 🟢 Tool 3: `create_ticket_and_notify`
Generates a formatted Linear ticket markdown AND Slack message in one call — no credentials needed to generate the formatted output:
```bash
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_ticket_and_notify","arguments":{"title":"TypeError: Cannot read properties of null","level":"fatal","sentry_url":"https://sentry.io/issues/123","priority":"P0","priority_num":1,"action":"Page on-call immediately.","event_count":200,"culprit_file":"src/api/auth.ts","culprit_line":42,"stack_summary":"src/api/auth.ts:42 in getUser","error_type":"TypeError","is_regression":false,"regression_evidence":"Fresh issue","author":"Prathamesh","author_email":"prathamesh@example.com","commit_sha":"abc1234","commit_message":"fix: handle null user","commit_url":"https://github.com/Botcoder757/sentry-triage-final/commit/abc1234","repo":"Botcoder757/sentry-triage-final"}},"id":3}'
```
Expected: `linearMd` (full markdown ticket ready for Linear) and `slackText` (formatted Slack message) in response.

---

#### 🔵 Tool 4: `deduplicate_check`
Checks if an issue was already triaged in the last hour:
```bash
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"deduplicate_check","arguments":{"issue_id":"abc123"}},"id":4}'
```
Expected: `{"already_triaged": false}` on first call.

---

#### 🔵 Tool 5: `record_triage`
Records a completed triage to prevent duplicate tickets for 1 hour:
```bash
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"record_triage","arguments":{"issue_id":"abc123","ticket_id":"ENG-42","ticket_url":"https://linear.app/team/ENG-42"}},"id":5}'
```
Expected: `{"recorded": true, "issue_id": "abc123"}`

> Now run `deduplicate_check` again with the same `issue_id` — it will return `already_triaged: true` ✅

---

#### 🔵 Webhook Endpoint
Simulate a Sentry alert firing:
```bash
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/webhook \
  -H "Content-Type: application/json" \
  -d '{"data": {"issue": {"id": "abc123"}}}'
```
Expected: `{"received": true, "issueId": "abc123"}`

Check the pending queue (the Construct agent polls this every 3 seconds):
```bash
curl https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/pending
```
Expected: `{"pending": ["abc123"]}`

---

### 🖥️ Option 2 — Full End-to-End via Construct Desktop

This is the intended production flow — the Construct Agent orchestrates all 5 tools automatically across Sentry, GitHub, Linear, and Slack.

**Prerequisites:** Connect these via Composio inside Construct Desktop:
1. **Sentry** (Project Issues enabled)
2. **Linear** (Ticket creation permissions)
3. **Slack** (Message post permissions)
4. **GitHub Personal Access Token** (`ghp_...`)

**Step 1. Link to Construct Desktop**
1. Open **Construct Desktop App** → **Settings** → **Developer**
2. Toggle **Developer Mode** ON
3. Under **Connect Dev Server**, paste:
   ```
   https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev
   ```
4. Click **Connect** — Construct loads the UI automatically

**Step 2. Configure the App**
1. Click **⚙️ Project Configuration** in the UI
2. Fill in your Sentry Org, Project, GitHub Repo, Branch, Slack Channel, Linear Team ID, and GitHub Token
3. Click **Save Configuration**

**Step 3. Trigger the Pipeline**
- Click **"Scan Sentry & Run Full Triage"** — the agent fetches the last 3 unresolved Sentry issues and runs the full 6-step pipeline autonomously
- OR paste the webhook URL into a Sentry Alert Rule for fully automatic triggering:
  ```
  https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/webhook
  ```

Watch the **Construct Chat Panel** — the agent declares each step as it fetches, parses, blames, files the Linear ticket, and posts the Slack alert.

---

## 🛠️ Architecture & Tools

| Tool | Capability |
|------|-----------|
| `triage_issue` | Parses stack trace, assigns P0-P3 priority, detects regression in one call |
| `blame_code_line` | GitHub GraphQL git blame — finds exact author of the culprit line |
| `create_ticket_and_notify` | Generates Linear ticket markdown + Slack message in one call |
| `deduplicate_check` | Checks if issue was already triaged in last hour |
| `record_triage` | Records completed triage to prevent duplicate tickets for 1 hour |

### The "All-in-One" Edge Compute Design Pattern
A common mistake when building agents is providing hundreds of granular micro-tools (`parse_JSON`, `regex_match`, `timestamp_convert`) which drains tokens and forces models to hallucinate intermediate steps.

Our `server.ts` combines data manipulation, analytics, and cleansing into rigid edge-compute abstractions — leaving the LLM free to do what it does best: **orchestrate business decisions based on parsed output.**

---

## 💻 Local Development

```bash
# Clone
git clone https://github.com/Botcoder757/sentry-triage-final.git
cd sentry-triage-final

# Install dependencies
npm install

# Start dev server (runs on localhost:8787)
npm run dev
```

Connect your Construct Desktop to `http://localhost:8787` in Developer Mode.