import { ConstructApp } from '@construct-computer/app-sdk';

const app = new ConstructApp({ name: 'sentry-auto-agent', version: '1.0.0' });

// ── Dedup store (resets on cold start) ────────────────────────────────────────
const triaged = new Map<string, { at: number; ticketId: string; ticketUrl: string }>();

// ── Helpers ───────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-construct-auth, x-construct-user, x-construct-env, x-construct-call-token',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

const LEVEL_SCORE: Record<string, number> = { fatal: 100, error: 50, warning: 20, info: 5 };
const LEVEL_EMOJI: Record<string, string> = { fatal: '💀', error: '🚨', warning: '⚠️', info: 'ℹ️' };
const PRIORITY_LABEL: Record<string, string> = { P0: '🔴 CRITICAL', P1: '🟠 HIGH', P2: '🟡 MEDIUM', P3: '🟢 LOW' };
const LANG_MAP: Record<string, string> = {
  '.py': 'Python', '.ts': 'TypeScript', '.js': 'JavaScript',
  '.rb': 'Ruby', '.go': 'Go', '.java': 'Java', '.cs': 'C#',
  '.php': 'PHP', '.rs': 'Rust', '.swift': 'Swift',
};

function getPriority(score: number, level: string): { priority: string; priorityNum: number; action: string } {
  if (score >= 150 || level === 'fatal') return { priority: 'P0', priorityNum: 1, action: 'Page on-call immediately. All hands on deck.' };
  if (score >= 100) return { priority: 'P1', priorityNum: 1, action: 'Assign to team lead. Fix before next deploy.' };
  if (score >= 60)  return { priority: 'P2', priorityNum: 2, action: 'Assign to code owner. Fix in current sprint.' };
  return { priority: 'P3', priorityNum: 3, action: 'Log it and fix when bandwidth allows.' };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 1: triage_issue
// Does parse + classify + regression detect in ONE call — saves 3 agent steps
// ─────────────────────────────────────────────────────────────────────────────
app.tool('triage_issue', {
  description: 'ALL-IN-ONE: Parses stack trace, classifies priority (P0-P3), and detects regression from a Sentry issue+event JSON. Call this once per issue instead of parse_stack_trace + classify_incident + detect_regression separately.',
  parameters: {
    issue_json:  { type: 'string', description: 'Full Sentry issue object as JSON string' },
    event_json:  { type: 'string', description: 'Full Sentry event object as JSON string (from SENTRY_FETCH_ISSUE_EVENT_BY_ID)' },
    limit:       { type: 'number', description: 'Max stack frames to return (default 5)' },
  },
  handler: async (args: any) => {
    let issue: any = {}, event: any = {};
    try { issue = typeof args.issue_json === 'string' ? JSON.parse(args.issue_json) : args.issue_json; } catch {}
    try { event = typeof args.event_json === 'string' ? JSON.parse(args.event_json) : args.event_json; } catch {}

    const limit = args.limit || 5;

    // ── Stack trace parsing ──────────────────────────────────────────────────
    const exEntry = event?.entries?.find((e: any) => e.type === 'exception');
    const rawFrames: any[] =
      exEntry?.data?.values?.[0]?.stacktrace?.frames ||
      event?.entries?.[0]?.data?.values?.[0]?.stacktrace?.frames ||
      event?.stacktrace?.frames || [];

    const appFrames = rawFrames.filter((f: any) => f.in_app !== false && f.filename);
    const frames = (appFrames.length ? appFrames : rawFrames).slice(-limit);
    const culprit = frames[frames.length - 1] || {};
    const ext = (culprit.filename || '').match(/\.[a-z]+$/i)?.[0]?.toLowerCase() || '';
    const exception = exEntry?.data?.values?.[0] || event?.exception?.values?.[0];

    const stackSummary = frames
      .map((f: any) => `  ${f.filename}:${f.lineNo || f.lineno || 0} in ${f.function || '?'}`)
      .join('\n');

    // ── Classification ───────────────────────────────────────────────────────
    const level = (issue.level || 'error').toLowerCase();
    const count = issue.count || issue.times_seen || 1;
    const users = issue.userCount || 0;
    const firstSeen = issue.firstSeen ? new Date(issue.firstSeen).getTime() : Date.now();
    const lastSeen  = issue.lastSeen  ? new Date(issue.lastSeen).getTime()  : Date.now();
    const ageHours  = (Date.now() - firstSeen) / 3_600_000;
    const windowH   = Math.max((lastSeen - firstSeen) / 3_600_000, 0.1);
    const rate      = count / windowH;

    let score = (LEVEL_SCORE[level] || 50);
    if (count > 100) score += 40; else if (count > 10) score += 20; else if (count > 3) score += 10;
    if (users > 50)  score += 40; else if (users > 10) score += 20; else if (users > 0) score += 10;
    if (rate > 50)   score += 30;
    if (ageHours < 1) score += 20;

    const { priority, priorityNum, action } = getPriority(score, level);

    // ── Regression detection ─────────────────────────────────────────────────
    const title = (issue.title || '').toLowerCase();
    const isRegression = issue.isRegression === true || issue.isRegression === 'true' ||
      ['regression','again','back','reappear','returned'].some(k => title.includes(k));

    const regressionEvidence = isRegression
      ? (issue.isRegression ? 'Sentry explicitly flagged as regression.' : `Title contains regression keyword. Issue age: ${Math.round(ageHours)}h.`)
      : `Fresh issue — ${Math.round(ageHours)}h old, ${count} events. No regression signals.`;

    return JSON.stringify({
      // Stack
      culpritFile:     culprit.filename || event?.culprit || 'unknown',
      culpritLine:     culprit.lineNo   || culprit.lineno || 0,
      culpritFunction: culprit.function || '',
      culpritContext:  culprit.context_line || '',
      language:        LANG_MAP[ext] || 'Unknown',
      stackSummary,
      errorType:       exception?.type  || issue.title?.split(':')[0] || 'UnknownError',
      errorValue:      (exception?.value || '').substring(0, 200),
      // Classification
      priority, priorityNum, action,
      severityScore: score,
      isSpike:  rate > 20,
      isNew:    ageHours < 2,
      ratePerHour: Math.round(rate * 10) / 10,
      // Regression
      isRegression,
      regressionEvidence,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 2: blame_code_line
// GitHub GraphQL git blame — finds EXACT author of the culprit line
// ─────────────────────────────────────────────────────────────────────────────
app.tool('blame_code_line', {
  description: 'Uses GitHub GraphQL git blame to find the EXACT author, commit, and message for a specific line in a file. More precise than listing commits.',
  parameters: {
    repo:         { type: 'string', description: 'GitHub repo as owner/repo e.g. Botcoder757/scribble-ai-tutor' },
    file_path:    { type: 'string', description: 'File path e.g. src/api/auth.ts' },
    line_number:  { type: 'number', description: 'The exact line number to blame (culpritLine from triage_issue)' },
    github_token: { type: 'string', description: 'GitHub personal access token (optional, uses env if not provided)' },
    branch:       { type: 'string', description: 'Branch to blame on (default: main)' },
  },
  handler: async (args: any) => {
    const [owner, repo] = (args.repo || '').split('/');
    const branch = args.branch || 'main';
    const lineNo  = args.line_number || 1;

    if (!owner || !repo) return JSON.stringify({ error: 'repo must be owner/repo format' });

    const query = `
      query($owner: String!, $repo: String!, $expr: String!, $path: String!) {
        repository(owner: $owner, name: $repo) {
          object(expression: $expr) {
            ... on Commit {
              blame(path: $path) {
                ranges {
                  startingLine
                  endingLine
                  commit {
                    oid
                    message
                    committedDate
                    author { name email }
                    url
                  }
                }
              }
            }
          }
        }
      }
    `;

    const variables = {
      owner,
      repo,
      expr: `${branch}:${args.file_path}`,
      path: args.file_path,
    };

    try {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${args.github_token || (globalThis as any).GITHUB_TOKEN || ''}`,
        },
        body: JSON.stringify({ query, variables }),
      });

      const data: any = await res.json();

      if (data.errors) {
        return JSON.stringify({ error: data.errors[0]?.message || 'GitHub GraphQL error', raw: data.errors });
      }

      const ranges: any[] = data?.data?.repository?.object?.blame?.ranges || [];
      const match = ranges.find(r => r.startingLine <= lineNo && r.endingLine >= lineNo);

      if (!match) {
        // Fall back to nearest range
        const nearest = ranges[ranges.length - 1];
        return JSON.stringify({
          found: false,
          note: `Line ${lineNo} not matched exactly, returning last blame range`,
          author:        nearest?.commit?.author?.name  || 'unknown',
          email:         nearest?.commit?.author?.email || 'unknown',
          commitSha:     nearest?.commit?.oid?.substring(0, 7) || '',
          commitMessage: nearest?.commit?.message?.split('\n')[0] || '',
          committedDate: nearest?.commit?.committedDate || '',
          commitUrl:     nearest?.commit?.url || '',
          lineRange:     `${nearest?.startingLine}-${nearest?.endingLine}`,
        });
      }

      return JSON.stringify({
        found:         true,
        author:        match.commit.author.name,
        email:         match.commit.author.email,
        commitSha:     match.commit.oid.substring(0, 7),
        commitMessage: match.commit.message.split('\n')[0],
        committedDate: match.commit.committedDate,
        commitUrl:     match.commit.url,
        lineRange:     `${match.startingLine}-${match.endingLine}`,
        exactLine:     lineNo,
      });
    } catch (err: any) {
      return JSON.stringify({ error: err.message || 'Network error calling GitHub GraphQL' });
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 3: create_ticket_and_notify
// Formats Linear description + Slack message in ONE call — saves 2 agent steps
// ─────────────────────────────────────────────────────────────────────────────
app.tool('create_ticket_and_notify', {
  description: 'ALL-IN-ONE: Generates formatted Linear ticket markdown AND Slack message from triage data. Call this once instead of format_linear_description + format_slack_message separately.',
  parameters: {
    title:               { type: 'string', description: 'Error title from Sentry' },
    level:               { type: 'string', description: 'Sentry level (fatal/error/warning/info)' },
    sentry_url:          { type: 'string', description: 'Link to Sentry issue' },
    priority:            { type: 'string', description: 'P0/P1/P2/P3 from triage_issue' },
    priority_num:        { type: 'number', description: 'Priority number (1-3)' },
    action:              { type: 'string', description: 'Recommended action from triage_issue' },
    event_count:         { type: 'number', description: 'Number of occurrences' },
    culprit_file:        { type: 'string', description: 'Culprit file from triage_issue' },
    culprit_line:        { type: 'number', description: 'Culprit line from triage_issue' },
    stack_summary:       { type: 'string', description: 'Stack summary from triage_issue' },
    error_type:          { type: 'string', description: 'Error type from triage_issue' },
    is_regression:       { type: 'boolean', description: 'Is regression from triage_issue' },
    regression_evidence: { type: 'string', description: 'Regression evidence from triage_issue' },
    author:              { type: 'string', description: 'Code author from blame_code_line' },
    author_email:        { type: 'string', description: 'Author email from blame_code_line' },
    commit_sha:          { type: 'string', description: 'Commit SHA from blame_code_line' },
    commit_message:      { type: 'string', description: 'Commit message from blame_code_line' },
    commit_url:          { type: 'string', description: 'Commit URL from blame_code_line' },
    repo:                { type: 'string', description: 'GitHub repo owner/repo' },
    linear_ticket_id:    { type: 'string', description: 'Linear ticket ID — fill in AFTER creating ticket' },
    linear_ticket_url:   { type: 'string', description: 'Linear ticket URL — fill in AFTER creating ticket' },
  },
  handler: async (args: any) => {
    const lvl   = (args.level || 'error').toLowerCase();
    const emoji = LEVEL_EMOJI[lvl] || '🚨';
    const reg   = args.is_regression;
    const badge = reg ? '⚠️ **REGRESSION**' : '🐛 **New Bug**';

    // ── Linear markdown ──────────────────────────────────────────────────────
    const linearMd = [
      `## ${emoji} ${badge} | ${args.priority || 'P2'} — Auto-Triaged`,
      '',
      `> **Action:** ${args.action || 'Investigate and fix.'}`,
      '',
      '---',
      '### 🎯 Error',
      `| Field | Value |`,
      `|---|---|`,
      `| **Error** | \`${args.title || 'Unknown'}\` |`,
      `| **Type** | ${args.error_type || '—'} |`,
      `| **Level** | ${lvl} |`,
      `| **Occurrences** | ${args.event_count || '?'} |`,
      `| **Sentry** | [View Issue](${args.sentry_url || '#'}) |`,
      '',
      '### 📁 Culprit',
      `| Field | Value |`,
      `|---|---|`,
      `| **File** | \`${args.culprit_file || 'unknown'}\` |`,
      `| **Line** | ${args.culprit_line || '?'} |`,
      '',
      '### 👤 Code Owner (git blame)',
      `| Field | Value |`,
      `|---|---|`,
      `| **Author** | ${args.author || 'unknown'} |`,
      `| **Email** | ${args.author_email || '—'} |`,
      args.commit_sha ? `| **Commit** | [\`${args.commit_sha}\`](${args.commit_url || '#'}) |` : '',
      args.commit_message ? `| **Message** | ${args.commit_message} |` : '',
      args.repo ? `| **Repo** | [${args.repo}](https://github.com/${args.repo}) |` : '',
      reg ? `\n### ⚠️ Regression\n${args.regression_evidence || ''}` : '',
      '',
      '### 🧵 Stack Trace',
      '```',
      args.stack_summary || 'No stack trace available.',
      '```',
      '',
      '---',
      `*Auto-triaged by Sentry Auto-Triage Agent — ${new Date().toUTCString()}*`,
    ].filter(Boolean).join('\n');

    // ── Slack message ────────────────────────────────────────────────────────
    const slackText = [
      `${emoji} *Sentry Incident*${reg ? ' | ⚠️ REGRESSION' : ''}`,
      `*Error:* <${args.sentry_url || '#'}|${args.title || 'Unknown'}>`,
      `*Severity:* ${PRIORITY_LABEL[args.priority || 'P2']} | ${args.event_count || '?'} occurrences`,
      `*Culprit:* \`${args.culprit_file || 'unknown'}:${args.culprit_line || '?'}\``,
      `*Blame:* ${args.author || 'unknown'} — _${args.commit_message || '—'}_`,
      args.linear_ticket_id
        ? `*Ticket:* <${args.linear_ticket_url || '#'}|${args.linear_ticket_id}>`
        : '*Ticket:* creating...',
      `*Action:* ${args.action || 'Investigate and fix.'}`,
    ].join('\n');

    return JSON.stringify({ linearMd, slackText });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 4: deduplicate_check
// ─────────────────────────────────────────────────────────────────────────────
app.tool('deduplicate_check', {
  description: 'Checks if this Sentry issue was already triaged in the last hour. Returns already_triaged: true to skip.',
  parameters: {
    issue_id: { type: 'string', description: 'Sentry issue ID' },
  },
  handler: async (args: any) => {
    const key = String(args.issue_id);
    const existing = triaged.get(key);
    if (existing) {
      const ageMin = (Date.now() - existing.at) / 60_000;
      if (ageMin < 60) {
        return JSON.stringify({
          already_triaged: true,
          triaged_minutes_ago: Math.round(ageMin),
          ticket_id: existing.ticketId,
          ticket_url: existing.ticketUrl,
        });
      }
    }
    return JSON.stringify({ already_triaged: false });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 5: record_triage
// ─────────────────────────────────────────────────────────────────────────────
app.tool('record_triage', {
  description: 'Records a completed triage to prevent duplicate tickets for 1 hour.',
  parameters: {
    issue_id:   { type: 'string', description: 'Sentry issue ID' },
    ticket_id:  { type: 'string', description: 'Linear ticket ID' },
    ticket_url: { type: 'string', description: 'Linear ticket URL' },
  },
  handler: async (args: any) => {
    triaged.set(String(args.issue_id), {
      at: Date.now(),
      ticketId:  args.ticket_id  || '',
      ticketUrl: args.ticket_url || '',
    });
    return JSON.stringify({ recorded: true, issue_id: args.issue_id });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom routes
// ─────────────────────────────────────────────────────────────────────────────
const pendingWebhooks: string[] = [];
const originalFetch = app.fetch.bind(app);

app.fetch = async (request: Request, env?: any) => {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (url.pathname === '/health') {
    return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain', ...CORS } });
  }

  if (url.pathname === '/webhook' && request.method === 'POST') {
    let body: any = {};
    try { body = await request.json(); } catch {}
    const issueId = body?.data?.issue?.id || body?.issue?.id || body?.id;
    if (!issueId) return json({ error: 'No issue ID in payload' }, 400);
    pendingWebhooks.push(String(issueId));
    return json({ received: true, issueId });
  }

  if (url.pathname === '/pending' && request.method === 'GET') {
    const payloads = [...pendingWebhooks];
    pendingWebhooks.length = 0;
    return json({ pending: payloads });
  }

  const response = await originalFetch(request, env);
  const newHeaders = new Headers(response.headers);
  Object.entries(CORS).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};

export default app;