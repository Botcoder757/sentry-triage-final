# Sentry Auto-Triage: Autonomous Construct Agent Workplace



An intelligent, fully autonomous business workflow agent built for the **CONSTRUCT × Techfluence 2026 App Store Bounty Track**.

This is not a simple notification wrapper or a chat bot. It is a true, persistent, autonomous edge application running on Cloudflare Workers that equips a **Construct OS Agent** to handle the entire lifecycle of an incident exactly like a Human DevOps/SRE Engineer would.



## 🏆 Bounty Submission Details

### 1. Business Impact: Real, End-to-End Automation
When a Sentry alert fires, resolving it requires context switching across 4-5 different web apps, taking 15-30 minutes of human time. This app completely entirely eliminates that operational overhead:
1. **Listens (Sentry):** Receives incident webhooks natively.
2. **Analyzes (Intelligent Agent):** Parses the stack trace, identifies the precise culprit file and line, and calculates an algorithmic priority score (e.g. fatal + spike = P0, warning + old = P3).
3. **Investigates (GitHub):** Executes a GraphQL git-blame on the exact culprit line to find the offending commit message and author.
4. **Documents (Linear):** Formats a rich Markdown ticket containing the stack trace, regression evidence, and code blame, directly assigning priority natively.
5. **Alerts (Slack):** Posts a clean, actionable summary to the engineering team's `#incidents` channel with ticket links attached.

### 2. Workflow Novelty
Our application implements complex logic typically missing from simple AI agents:
- **Stateful Deduplication check:** Ensures that an incident is only triaged once an hour to protect the team from alert fatigue and duplicate tickets.
- **Micro-Analysis:** Sentry provides long messy traces; our specific `triage_issue` tool filters out framework internals and hones strictly on the precise application code that threw the error.
- **Git Blame Accuracy:** The agent executes a recursive GraphQL call back into GitHub to find the actual code owner of the line, not just whoever touched the file last.

### 3. Technical Quality
Built natively on **Cloudflare Workers** using `@construct-computer/app-sdk`. 
- Completely Serverless & Edge Optimized.
- Bypasses slow agent prompting by performing data manipulation natively in TypeScript edge functions before returning pure, actionable data to the Construct LLM agent.

---

## 👨‍⚖️ FOR THE JUDGES: How to Test

### **Prerequisites & Credentials**
To run this end-to-end exactly as intended, you need accounts linked via **Composio** inside your Construct OS Desktop App sandbox:
1. **Sentry** (Project Issues enabled)
2. **Linear** (Ticket creation permissions)
3. **Slack** (Message post permissions in a channel e.g. `#incidents`)
4. **GitHub Personal Access Token** (Optional but recommended for precise blame matching. Needed in configuration)

### **Testing Locally or via Deployed App**

The App is deployed LIVE to Cloudflare Workers: 
`https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev`

**Step 1. Link to Construct Desktop**
1. Open up **Construct Desktop App** → **Settings** → **Developer**.
2. Toggle **Developer Mode** to ON.
3. Under **Connect Dev Server**, paste `https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev` and click **Connect**.
4. Construct will load the UI!

**Step 2. Configure the App Environment**
1. In the beautifully redesigned App UI, click **⚙️ Project Configuration**.
2. Fill out your details:
   - **Sentry Org & Project**: e.g. `acme-corp` and `backend-api`
   - **GitHub Repo & Branch**: e.g. `construct-computer/app-sdk` and `main`
   - **Slack Channel**: e.g. `#incidents-test`
   - **Linear Team ID**: e.g. `CSTC-1234`
   - **GitHub Token**: Paste your classic `ghp_...` token so the GraphQL git-blame tool works.
3. Click "Save Configuration".

**Step 3. Trigger the Autonomous Pipeline!**
You have two ways to execute the workflow:
- **Manual Scan**: Click the big red button, **"Scan Sentry & Run Full Triage"**. The desktop agent will wake up, discover the last 3 unresolved issues from Sentry, and independently execute the 6-step cross-platform triage logic. 
- **Automatic Webhook**: Copy the webhook URL from the bottom of the UI and paste it into a Sentry Alert Rule. The desktop will transparently poll our Worker, spinning into action the moment an alert fires:
  ```
  https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/webhook
  ```

Watch your Construct Chat Panel. The Agent will transparently declare it is fetching, parsing, git blaming, filing, and notifying across your tech stack!

### **Quick Curl Tests (No Setup Required)**

You can also verify the deployed Worker directly without any credentials:

```bash
# 1. Health check
curl https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/health

# 2. Simulate a Sentry webhook
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/webhook \
  -H "Content-Type: application/json" \
  -d '{"data": {"issue": {"id": "abc123"}}}'

# 3. Check pending queue
curl https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/pending

# 4. Test triage_issue tool
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/tools/triage_issue \
  -H "Content-Type: application/json" \
  -d '{
    "issue_json": "{\"level\":\"fatal\",\"count\":200,\"userCount\":80,\"title\":\"TypeError: Cannot read properties of null\",\"firstSeen\":\"2026-04-22T00:00:00Z\",\"lastSeen\":\"2026-04-22T01:00:00Z\"}",
    "event_json": "{}",
    "limit": 5
  }'

# 5. Test deduplicate_check tool
curl -X POST https://construct-app-sentry-auto-agent.naikprathamesh782.workers.dev/tools/deduplicate_check \
  -H "Content-Type: application/json" \
  -d '{"issue_id": "abc123"}'
```

---

## 🛠️ Architecture & Under the Hood

### Application Tools
The App SDK serves 5 precise tools dynamically injected into the workspace of the Construct Agent at runtime:

| Tool | Capability |
|------|-----------|
| `triage_issue` | Single-shot utility that parses massive JSON footprints into a 20-word summary, assigns P0-P3, and scans for regression behavior based on event counts. |
| `blame_code_line` | Interfaces with GitHub's GraphQL `blame` API to execute exact line matching. |
| `create_ticket_and_notify` | Consolidates Linear Markdowns & Slack rich-text formats to lower the Agent's token footprint. |
| `deduplicate_check` | Stateful 1-hour rolling deduplication map memory. |
| `record_triage` | Post-execution hook to commit the triage session. |

### The "All-in-One" Edge Compute Design Pattern
A common mistake when building Agents is providing them hundreds of raw granular micro-tools (e.g. `parse_JSON`, `regex_match`, `timestamp_convert`), which drains tokens and forces the deep-learning models to hallucinate intermediate steps.

Our `server.ts` combines data manipulation, analytics, and data-cleansing into rigid edge-compute abstractions, leaving the LLM free to perform the one thing it is unmatched at doing: *Orchestrating Business Decisions based on the parsed output.*

## 💻 Local Development

Want to test it locally?

```bash
# Clone
git clone https://github.com/construct-computer/sentry-auto-agent.git
cd sentry-auto-agent

# Install dependencies
npm install

# Start the dev server (runs on localhost:8787)
npm run dev
```

Connect your Construct OS Desktop to `http://localhost:8787` in Developer Mode.