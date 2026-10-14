/**
 * 会话语料提取：把本机 DSH 与 Codex 会话里的「用户消息」抽出来，供复盘统计使用。
 *
 * - DSH：~/.dsh/sessions/<编码后的工作目录>/session-<id>/session.v3.jsonl.zstd（用 zstd -dc 解压）
 * - Codex：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl（明文）
 *
 * 关键点：必须剔除「系统注入的伪用户消息」。它们长得像用户发言，但其实是运行时塞进去的
 * （workspace instructions、runtime context、后台任务通知、Codex 审批代理模板…）。
 * 不剔除会让样本虚高 40% 以上——实测某项目 208 条里有 83 条是注入。
 *
 * 运行：
 *   node extract-sessions.mjs                # 提取全部项目，按项目分别落盘
 *   node extract-sessions.mjs "物流数据监控"  # 只提取 cwd 命中该关键字的项目
 * 输出（写到当前目录）：
 *   .probe/proj-<项目>.jsonl            每个项目的用户消息
 *   .probe/session-user-messages.jsonl  汇总（summarize-sessions.mjs 也读它）
 *
 * 前置：DSH 会话是 zstd 压缩的，需要 zstd 可执行文件（macOS: brew install zstd）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const DSH_ROOT = path.join(HOME, '.dsh', 'sessions');
const CODEX_ROOT = path.join(HOME, '.codex', 'sessions');
const keyword = process.argv[2] || '';
const outDir = path.resolve('.probe');

/** 系统注入的伪用户消息：不是用户说的话，必须剔除。 */
const NOISE_PATTERNS = [
  /^<system-reminder>/,
  /^<recommended_plugins>/,
  /^<environment_context>/,
  /^<user_instructions>/,
  /^<turn_aborted>/,
  /^<plugin_/,
  /^<permissions /,
  /^<current_time>/,
  /^Current runtime context/,
  /^background job /,
  /^background subagent /,
  /^Background subagent /,
  /^Agent \S+ sent a message/,
  /^The following is the Codex agent history/,
  /^This is an automatically generated checkpoint/,
  /^<goal_round>|^<goal_complete>/,
  /^\[model changed:/,
  /^# AGENTS\.md instructions/,
  /^# Files mentioned by the user:/,
  /^<in-app-browser-context/,
  /^<local-command/,
  /^<command-name>/
];

function cleanText(text) {
  const value = String(text ?? '').trim();
  if (!value) return '';
  for (const pattern of NOISE_PATTERNS) if (pattern.test(value)) return '';
  return value;
}

/** 把消息 content（可能是 JSON 字符串、数组或纯文本）拍平成文本。 */
function flattenContent(content) {
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('\n');
  const raw = String(content ?? '');
  if (!raw.startsWith('[')) return raw;
  try {
    return JSON.parse(raw).map((part) => part?.text || '').join('\n');
  } catch {
    return raw;
  }
}

/** 项目名：取 cwd 最后一段，作为落盘文件名。 */
const projectName = (cwd) => path.basename(String(cwd || 'unknown').replace(/[\\/]+$/, '')) || 'unknown';

function extractDsh() {
  const messages = [];
  const perProject = new Map();
  if (!fs.existsSync(DSH_ROOT)) return { messages, perProject };
  for (const projectDirName of fs.readdirSync(DSH_ROOT)) {
    const projectDir = path.join(DSH_ROOT, projectDirName);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    let cwd = '';
    let sessionCount = 0;
    for (const sessionDirName of fs.readdirSync(projectDir)) {
      const file = path.join(projectDir, sessionDirName, 'session.v3.jsonl.zstd');
      if (!fs.existsSync(file)) continue;
      let lines;
      try {
        lines = execFileSync('zstd', ['-dc', file], { maxBuffer: 1 << 30 }).toString('utf8').split('\n');
      } catch {
        continue; // 缺 zstd 或文件损坏：跳过该会话，不让整个统计失败
      }
      sessionCount += 1;
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === 'session' && event.cwd) cwd = event.cwd;
        if (event.type !== 'user/message') continue;
        const text = cleanText(flattenContent(event.data?.content));
        if (!text) continue;
        if (keyword && !cwd.includes(keyword)) continue;
        messages.push({ source: 'dsh', project: cwd, session: sessionDirName, time: event.time || null, text });
      }
    }
    if (cwd) perProject.set(projectDirName, { sessions: sessionCount, cwd });
  }
  return { messages, perProject };
}

function extractCodex() {
  const messages = [];
  const perProject = new Map();
  if (!fs.existsSync(CODEX_ROOT)) return { messages, perProject };
  const stack = [CODEX_ROOT];
  const files = [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.jsonl')) files.push(full);
    }
  }
  for (const file of files) {
    let cwd = '';
    const rows = [];
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === 'session_meta' && event.payload?.cwd) cwd = event.payload.cwd;
      if (event.type !== 'response_item' || event.payload?.type !== 'message' || event.payload.role !== 'user') continue;
      const text = cleanText(flattenContent(event.payload.content));
      if (!text) continue;
      rows.push({ source: 'codex', project: cwd, session: path.basename(file), time: event.timestamp || null, text });
    }
    if (!rows.length) continue;
    if (keyword && !cwd.includes(keyword)) continue;
    messages.push(...rows);
    const key = projectName(cwd);
    const stat = perProject.get(key) || { sessions: 0, cwd };
    stat.sessions += 1;
    perProject.set(key, stat);
  }
  return { messages, perProject };
}

const dsh = extractDsh();
const codex = extractCodex();
const all = [...dsh.messages, ...codex.messages].sort((a, b) => String(a.time).localeCompare(String(b.time)));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'session-user-messages.jsonl'), all.map((item) => JSON.stringify(item)).join('\n'));

/** 按项目分别落盘：session-report.mjs 逐项目统计就靠这些文件。 */
const byProject = new Map();
for (const item of all) {
  const key = projectName(item.project);
  if (!byProject.has(key)) byProject.set(key, []);
  byProject.get(key).push(item);
}
for (const [key, items] of byProject) {
  fs.writeFileSync(path.join(outDir, `proj-${key}.jsonl`), items.map((item) => JSON.stringify(item)).join('\n'));
}

console.log(`DSH：${dsh.perProject.size} 个项目 → ${dsh.messages.length} 条真实用户消息`);
console.log(`Codex：${codex.perProject.size} 个项目 → ${codex.messages.length} 条真实用户消息`);
console.log(`合计：${all.length} 条，分属 ${byProject.size} 个项目${keyword ? `（已按关键字「${keyword}」过滤）` : ''}`);
console.log('\n各项目消息数：');
for (const [key, items] of [...byProject.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(items.length).padStart(5)}  ${key}`);
}
console.log('\n已写出 .probe/proj-*.jsonl 与 .probe/session-user-messages.jsonl');
