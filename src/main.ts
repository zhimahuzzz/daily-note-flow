import {
  App,
  ItemView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFolder,
  TFile,
  WorkspaceLeaf,
  requestUrl
} from "obsidian";

const VIEW_TYPE = "daily-note-flow-view";
const PREVIEW_VIEW_TYPE = "daily-note-flow-preview-view";

type TimePeriod = "morning" | "afternoon" | "evening";

interface DailyNoteFlowSettings {
  rootFolder: string;
  apiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  taskTemplates: TaskTemplate[];
}

type ScheduleType = "daily" | "weekly" | "interval" | "workdays";

interface TaskTemplate {
  id: string;
  title: string;
  enabled: boolean;
  scheduleType: ScheduleType;
  weekdays: number[];
  intervalDays: number;
  startDate: string;
}

interface DailyRecord {
  time: string;
  content: string;
}

interface TaskItem {
  checked: boolean;
  content: string;
}

interface ParsedDailyNote {
  tasks: string[];
  todos: string[];
  records: Record<TimePeriod, DailyRecord[]>;
  summary: string;
}

interface DailyNoteEntry {
  date: Date;
  key: string;
  note: ParsedDailyNote;
}

interface SummaryPreviewState {
  title: string;
  file: TFile;
  body: string;
}

type JsonObject = Record<string, unknown>;

const DEFAULT_SETTINGS: DailyNoteFlowSettings = {
  rootFolder: "Daliy_Note",
  apiKey: "",
  aiBaseUrl: "https://api.deepseek.com",
  aiModel: "deepseek-v4-flash",
  taskTemplates: []
};

function normalizeAiModel(value: string) {
  const model = value.trim();
  if (!model || model === "deepseek-v3") return "deepseek-v4-flash";
  return model;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const CHINESE_WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function formatChineseDateKey(date: Date) {
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${CHINESE_WEEKDAYS[date.getDay()]}`;
}

function formatTime(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getIsoWeekKey(date: Date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${pad(week)}`;
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function getMonthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end };
}

function getWeekRange(date: Date) {
  const base = new Date(date);
  const day = base.getDay() || 7;
  const start = new Date(base);
  start.setDate(base.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function isDateInRange(date: Date, start: Date, end: Date) {
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function parseDateKey(key: string) {
  // 旧格式：2026-08-26
  const parts = key.split("-");
  if (parts.length === 3) {
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }
  // 新格式：2026年08月26日 星期三
  const match = /^(\d{4})年(\d{2})月(\d{2})日/.exec(key);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }
  return null;
}

function formatTaskLine(line: string) {
  return line.startsWith("- ") ? line : `- ${line}`;
}

function parseTaskLine(line: string): TaskItem {
  const match = /^-\s+(?:\[([ xX])\]\s*)?(.*)$/.exec(line);
  if (!match) return { checked: false, content: line.trim() };
  const checked = match[1] ? /[xX]/.test(match[1]) : false;
  const content = (match[2] || "").trim();
  return { checked, content };
}

function renderTaskLine(task: TaskItem): string {
  const marker = task.checked ? "[x]" : "[ ]";
  return `- ${marker} ${task.content}`.trim();
}

function createTaskListSection(
  container: Element,
  title: string,
  tasks: string[],
  onChange?: () => void,
  onStructuralChange?: () => void
): () => string[] {
  const section = container.createDiv({ cls: "daily-note-flow-section" });
  section.createEl("h3", { text: title });

  const listEl = section.createDiv({ cls: "daily-note-flow-task-list" });
  const taskRefs: Array<{ checkbox: HTMLInputElement; input: HTMLInputElement; row: HTMLElement }> = [];

  const addTaskRow = (task: TaskItem) => {
    const row = listEl.createDiv({ cls: "daily-note-flow-task-row" });
    const checkbox = row.createEl("input", { type: "checkbox" });
    checkbox.checked = task.checked;
    checkbox.addEventListener("change", () => { onChange?.(); });
    const input = row.createEl("input", {
      type: "text",
      cls: "daily-note-flow-grow",
      value: task.content
    });
    input.addEventListener("input", () => { onChange?.(); });
    const deleteBtn = row.createEl("button", { text: "\u00d7", cls: "daily-note-flow-task-delete" });
    deleteBtn.onclick = () => {
      row.remove();
      onStructuralChange?.();
    };
    taskRefs.push({ checkbox, input, row });
  };

  for (const line of tasks) {
    addTaskRow(parseTaskLine(line));
  }

  const addRow = section.createDiv({ cls: "daily-note-flow-task-row" });
  const addInput = addRow.createEl("input", {
    type: "text",
    cls: "daily-note-flow-grow",
    placeholder: `Add ${title.toLowerCase()}...`
  });
  const addBtn = addRow.createEl("button", { text: "Add" });
  const doAdd = () => {
    if (!addInput.value.trim()) return;
    addTaskRow({ checked: false, content: addInput.value.trim() });
    addInput.value = "";
    addInput.focus();
    onStructuralChange?.();
  };
  addBtn.onclick = doAdd;
  addInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doAdd();
    }
  });

  return () => {
    const result: string[] = [];
    for (const ref of taskRefs) {
      if (!ref.row.isConnected) continue;
      const content = ref.input.value.trim();
      if (!content) continue;
      result.push(renderTaskLine({ checked: ref.checkbox.checked, content }));
    }
    return result;
  };
}

function formatRecordLines(records: DailyRecord[]): string[] {
  return records.map((record): string => {
    const content = record.content.trim();
    return content ? `- ${record.time} ${content}` : `- ${record.time}`;
  });
}

function timePeriodFromTime(time: string): TimePeriod {
  const hour = Number(time.split(":")[0] ?? "0");
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function isHeading(line: string, level: number, title: string) {
  return line.startsWith(`${"#".repeat(level)} ${title}`);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is Array<unknown> {
  return Array.isArray(value);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseRecordLine(line: string): DailyRecord | null {
  const match = /^-\s+(\d{2}:\d{2})\s*(.*)$/.exec(line);
  if (!match) return null;
  return {
    time: match[1],
    content: match[2].trim()
  };
}

function ensureFolderPath(folderPath: string) {
  return folderPath.replace(/\/+$/g, "").trim();
}

function getDailyFolder(rootFolder: string) {
  return `${ensureFolderPath(rootFolder)}/Daily`;
}

function getWeeklyFolder(rootFolder: string) {
  return `${ensureFolderPath(rootFolder)}/Weekly`;
}

function getMonthlyFolder(rootFolder: string) {
  return `${ensureFolderPath(rootFolder)}/Monthly`;
}

function createEmptyNote(): ParsedDailyNote {
  return {
    tasks: [],
    todos: [],
    records: { morning: [], afternoon: [], evening: [] },
    summary: ""
  };
}

function getTasksForDate(templates: TaskTemplate[], date: Date): string[] {
  const result: string[] = [];
  const dayOfWeek = date.getDay();
  for (const tpl of templates) {
    if (!tpl.enabled || !tpl.title.trim()) continue;
    let match = false;
    switch (tpl.scheduleType) {
      case "daily":
        match = true;
        break;
      case "workdays":
        match = dayOfWeek >= 1 && dayOfWeek <= 5;
        break;
      case "weekly":
        match = tpl.weekdays.includes(dayOfWeek);
        break;
      case "interval":
        if (tpl.startDate) {
          const start = new Date(tpl.startDate + "T00:00:00");
          const diffMs = date.getTime() - start.getTime();
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          match = diffDays >= 0 && diffDays % (tpl.intervalDays || 1) === 0;
        }
        break;
    }
    if (match) {
      result.push(`- [ ] ${tpl.title.trim()}`);
    }
  }
  return result;
}

function renderDailyNote(date: Date, parsed: ParsedDailyNote) {
  const lines: string[] = [];
  lines.push(`# ${formatChineseDateKey(date)}`);
  lines.push("");
  lines.push("## Daily Tasks");
  lines.push(...parsed.tasks);
  lines.push("");
  lines.push("## Todos");
  lines.push(...parsed.todos);
  lines.push("");
  lines.push("## Records");
  lines.push("");
  for (const period of ["morning", "afternoon", "evening"] as TimePeriod[]) {
    const title = period === "morning" ? "Morning Records" : period === "afternoon" ? "Afternoon Records" : "Evening Records";
    lines.push(`### ${title}`);
    const items = parsed.records[period].slice().sort((a, b) => a.time.localeCompare(b.time));
    if (items.length === 0) {
      lines.push("");
      continue;
    }
    for (const item of items) {
      const content = item.content.trim();
      if (content) {
        const contentLines = content.split(/\r?\n/);
        lines.push(`- ${item.time} ${contentLines[0]}`);
        for (let i = 1; i < contentLines.length; i++) {
          lines.push(`  ${contentLines[i]}`);
        }
      } else {
        lines.push(`- ${item.time}`);
      }
    }
    lines.push("");
  }
  lines.push("## Summary");
  lines.push(parsed.summary.trim());
  lines.push("");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function parseDailyNote(content: string): ParsedDailyNote {
  const note = createEmptyNote();
  const lines: string[] = content.split(/\r?\n/);
  let section = "";
  let recordPeriod: TimePeriod | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (isHeading(line, 2, "Daily Tasks")) {
      section = "tasks";
      recordPeriod = null;
      continue;
    }
    if (isHeading(line, 2, "Todos")) {
      section = "todos";
      recordPeriod = null;
      continue;
    }
    if (isHeading(line, 2, "Records")) {
      section = "records";
      recordPeriod = null;
      continue;
    }
    if (isHeading(line, 2, "Summary")) {
      section = "summary";
      recordPeriod = null;
      continue;
    }
    if (section === "records" && line.startsWith("### ")) {
      if (line.includes("Morning")) recordPeriod = "morning";
      else if (line.includes("Afternoon")) recordPeriod = "afternoon";
      else if (line.includes("Evening")) recordPeriod = "evening";
      continue;
    }
    if (section === "tasks" && line.startsWith("- ")) {
      note.tasks.push(line);
      continue;
    }
    if (section === "todos" && line.startsWith("- ")) {
      note.todos.push(line);
      continue;
    }
    if (section === "records" && recordPeriod) {
      if (line.startsWith("- ")) {
        const record = parseRecordLine(line);
        if (record) note.records[recordPeriod].push(record);
        continue;
      }
      if (line.startsWith("  ") && note.records[recordPeriod].length > 0) {
        const lastRecord = note.records[recordPeriod][note.records[recordPeriod].length - 1];
        lastRecord.content += "\n" + line.substring(2);
        continue;
      }
    }
    if (section === "summary") {
      note.summary = `${note.summary}\n${line}`.trim();
    }
  }

  return note;
}

async function ensureFolder(app: App, folderPath: string) {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!folder) {
    await app.vault.createFolder(folderPath);
  }
}

async function listDailyEntries(app: App, rootFolder: string, start: Date, end: Date): Promise<DailyNoteEntry[]> {
  const entries: DailyNoteEntry[] = [];
  const folder = getDailyFolder(rootFolder);
  const folderFile = app.vault.getAbstractFileByPath(folder);
  if (!folderFile || !(folderFile instanceof TFolder)) {
    return entries;
  }
  for (const child of folderFile.children as Array<TFile | TFolder>) {
    if (!(child instanceof TFile) || !child.path.endsWith(".md")) continue;
    const baseName = child.basename;
    const date = parseDateKey(baseName);
    if (!date || !isDateInRange(date, start, end)) continue;
    const note = parseDailyNote(await app.vault.read(child));
    entries.push({ date, key: baseName, note });
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  return entries;
}

function renderWeeklySummary(date: Date, entries: DailyNoteEntry[]) {
  const lines: string[] = [];
  lines.push(`## Range`);
  lines.push(`- Week: ${getIsoWeekKey(date)}`);
  lines.push("");
  for (const entry of entries) {
    lines.push(`### ${formatDate(entry.date)}`);
    if (entry.note.tasks.length) {
      lines.push("#### Daily Tasks");
      lines.push(...entry.note.tasks.map(formatTaskLine));
      lines.push("");
    }
    if (entry.note.todos.length) {
      lines.push("#### Todos");
      lines.push(...entry.note.todos.map(formatTaskLine));
      lines.push("");
    }
    for (const period of ["morning", "afternoon", "evening"] as TimePeriod[]) {
      const records = entry.note.records[period];
      if (!records.length) continue;
      lines.push(`#### ${period === "morning" ? "Morning" : period === "afternoon" ? "Afternoon" : "Evening"} Records`);
      lines.push(...formatRecordLines(records));
      lines.push("");
    }
    if (entry.note.summary.trim()) {
      lines.push("#### Summary");
      lines.push(entry.note.summary.trim());
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

function renderMonthlySummary(date: Date, entries: DailyNoteEntry[]) {
  const lines: string[] = [];
  lines.push(`## Range`);
  lines.push(`- Month: ${getMonthKey(date)}`);
  lines.push("");
  for (const entry of entries) {
    lines.push(`### ${formatDate(entry.date)}`);
    if (entry.note.tasks.length) {
      lines.push("#### Daily Tasks");
      lines.push(...entry.note.tasks.map(formatTaskLine));
      lines.push("");
    }
    if (entry.note.todos.length) {
      lines.push("#### Todos");
      lines.push(...entry.note.todos.map(formatTaskLine));
      lines.push("");
    }
    for (const period of ["morning", "afternoon", "evening"] as TimePeriod[]) {
      const records = entry.note.records[period];
      if (!records.length) continue;
      lines.push(`#### ${period === "morning" ? "Morning" : period === "afternoon" ? "Afternoon" : "Evening"} Records`);
      lines.push(...formatRecordLines(records));
      lines.push("");
    }
    if (entry.note.summary.trim()) {
      lines.push("#### Summary");
      lines.push(entry.note.summary.trim());
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}

function extractTaskText(line: string): string {
  return line.replace(/^-\s*\[[ xX]\]\s*/, "").trim();
}

function isTaskCompleted(line: string): boolean {
  return /^-\s*\[[xX]\]/.test(line);
}

function generateStructuredSummary(date: Date, entries: DailyNoteEntry[], kind: "weekly" | "monthly"): string {
  const lines: string[] = [];
  const rangeLabel = kind === "weekly" ? `Week ${getIsoWeekKey(date)}` : `${getMonthKey(date)}`;
  lines.push(`## Overview`);
  lines.push(`- Period: ${rangeLabel}`);
  lines.push(`- Days with notes: ${entries.length}`);
  lines.push("");

  const allTasks: string[] = [];
  const completedTasks: string[] = [];
  const pendingTasks: string[] = [];
  const allRecords: DailyRecord[] = [];
  const summaryTexts: string[] = [];

  for (const entry of entries) {
    for (const t of [...entry.note.tasks, ...entry.note.todos]) {
      const text = extractTaskText(t);
      if (!text) continue;
      allTasks.push(text);
      if (isTaskCompleted(t)) completedTasks.push(text);
      else pendingTasks.push(text);
    }
    for (const period of ["morning", "afternoon", "evening"] as TimePeriod[]) {
      allRecords.push(...entry.note.records[period]);
    }
    if (entry.note.summary.trim()) summaryTexts.push(entry.note.summary.trim());
  }

  lines.push(`## Task Overview`);
  lines.push(`- Total tasks: ${allTasks.length}`);
  lines.push(`- Completed: ${completedTasks.length}`);
  lines.push(`- Pending: ${pendingTasks.length}`);
  if (allTasks.length > 0) {
    const completionRate = Math.round((completedTasks.length / allTasks.length) * 100);
    lines.push(`- Completion rate: ${completionRate}%`);
  }
  lines.push("");

  if (completedTasks.length > 0) {
    lines.push(`## Completed`);
    const completedCount = new Map<string, number>();
    for (const t of completedTasks) completedCount.set(t, (completedCount.get(t) || 0) + 1);
    const sorted = [...completedCount.entries()].sort((a, b) => b[1] - a[1]);
    for (const [text, count] of sorted.slice(0, 15)) {
      lines.push(`- [x] ${text}${count > 1 ? ` (×${count})` : ""}`);
    }
    lines.push("");
  }

  if (pendingTasks.length > 0) {
    lines.push(`## Pending / Follow-up`);
    const pendingCount = new Map<string, number>();
    for (const t of pendingTasks) pendingCount.set(t, (pendingCount.get(t) || 0) + 1);
    const sorted = [...pendingCount.entries()].sort((a, b) => b[1] - a[1]);
    for (const [text, count] of sorted.slice(0, 15)) {
      lines.push(`- [ ] ${text}${count > 1 ? ` (×${count})` : ""}`);
    }
    lines.push("");
  }

  if (allRecords.length > 0) {
    lines.push(`## Records Highlights`);
    lines.push(`- Total records: ${allRecords.length}`);
    const recordTexts = allRecords.map((r) => r.content.split("\n")[0].trim()).filter((t) => t.length > 0);
    const recordCount = new Map<string, number>();
    for (const t of recordTexts) recordCount.set(t, (recordCount.get(t) || 0) + 1);
    const sorted = [...recordCount.entries()].sort((a, b) => b[1] - a[1]);
    for (const [text, count] of sorted.slice(0, 10)) {
      lines.push(`- ${text}${count > 1 ? ` (×${count})` : ""}`);
    }
    lines.push("");
  }

  if (summaryTexts.length > 0) {
    lines.push(`## Daily Summaries`);
    for (let i = 0; i < summaryTexts.length; i++) {
      const entry = entries[i];
      if (entry) lines.push(`### ${formatDate(entry.date)}`);
      lines.push(summaryTexts[i]);
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

function buildSummaryPrompt(date: Date, entries: DailyNoteEntry[], kind: "weekly" | "monthly"): string {
  const rangeLabel = kind === "weekly" ? `Week ${getIsoWeekKey(date)}` : `${getMonthKey(date)}`;
  const parts: string[] = [];
  parts.push(`You are writing a ${kind === "weekly" ? "weekly" : "monthly"} review summary for ${rangeLabel}.`);
  parts.push(`Analyze the daily notes below and produce a concise, insightful Chinese Markdown summary.`);
  parts.push(`Do NOT just list each day's content. Instead, synthesize and highlight:`);
  parts.push(`1. Key accomplishments and completed items`);
  parts.push(`2. Recurring themes or patterns`);
  parts.push(`3. Progress and trends observed`);
  parts.push(`4. Unfinished items or blockers that need follow-up`);
  parts.push(`5. Notable records or events`);
  parts.push(``);
  parts.push(`Here are the daily notes:`);
  parts.push(``);

  for (const entry of entries) {
    parts.push(`### ${formatDate(entry.date)}`);
    if (entry.note.tasks.length) {
      parts.push(`**Daily Tasks:**`);
      parts.push(...entry.note.tasks);
    }
    if (entry.note.todos.length) {
      parts.push(`**Todos:**`);
      parts.push(...entry.note.todos);
    }
    const allRecords = [...entry.note.records.morning, ...entry.note.records.afternoon, ...entry.note.records.evening];
    if (allRecords.length) {
      parts.push(`**Records:**`);
      for (const r of allRecords) parts.push(`- ${r.time} ${r.content}`);
    }
    if (entry.note.summary.trim()) {
      parts.push(`**Summary:** ${entry.note.summary.trim()}`);
    }
    parts.push(``);
  }

  parts.push(`Please write the summary now in Chinese Markdown. Start directly with the summary content, no preamble.`);
  return parts.join("\n");
}

function previewSummaryContent(title: string, body: string) {
  return `# ${title}\n\n${body.trim()}\n`;
}

function extractAiContent(responseText: string): string {
  const payload = safeJsonParse(responseText);
  if (!isJsonObject(payload)) return "";
  const choices = payload.choices;
  if (!isUnknownArray(choices) || choices.length === 0) return "";
  const firstChoice: unknown = choices[0];
  if (!isJsonObject(firstChoice)) return "";
  const message = firstChoice.message;
  if (!isJsonObject(message)) return "";
  const content = message.content;
  return typeof content === "string" ? content.trim() : "";
}

export default class DailyNoteFlowPlugin extends Plugin {
  settings: DailyNoteFlowSettings;
  summaryPreviewState: SummaryPreviewState | null = null;

  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new DailyNoteFlowView(leaf, this));
    this.registerView(PREVIEW_VIEW_TYPE, (leaf) => new DailyNoteFlowPreviewView(leaf, this));
    this.addRibbonIcon("notebook-pen", "Daily Note Flow", () => {
      void this.openPanel();
    });
    this.addCommand({
      id: "open",
      name: "Open daily note",
      callback: () => void this.openPanel()
    });
    this.addSettingTab(new DailyNoteFlowSettingTab(this.app, this));
  }

  async loadSettings() {
    const stored = await this.loadData() as Partial<DailyNoteFlowSettings> & { deepseekApiKey?: string } | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    if (!this.settings.apiKey && stored?.deepseekApiKey) {
      this.settings.apiKey = stored.deepseekApiKey;
    }
    if (!this.settings.taskTemplates) {
      this.settings.taskTemplates = [];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async openPanel() {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
  }

  async openPreview(title: string, file: TFile, body: string) {
    this.summaryPreviewState = { title, file, body };
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: PREVIEW_VIEW_TYPE, active: true });
  }

  async getDailyFile(date = new Date()): Promise<TFile> {
    const folder = getDailyFolder(this.settings.rootFolder);
    const newPath = `${folder}/${formatChineseDateKey(date)}.md`;
    const oldPath = `${folder}/${formatDate(date)}.md`;

    let file = this.app.vault.getAbstractFileByPath(newPath);
    if (file instanceof TFile) return file;

    file = this.app.vault.getAbstractFileByPath(oldPath);
    if (file instanceof TFile) return file;

    await ensureFolder(this.app, folder);
    const initialNote = createEmptyNote();
    initialNote.tasks = getTasksForDate(this.settings.taskTemplates, date);
    file = await this.app.vault.create(newPath, renderDailyNote(date, initialNote));
    if (!(file instanceof TFile)) {
      throw new Error(`Unable to create daily note at ${newPath}`);
    }
    return file;
  }

  hasDailyNote(date: Date): boolean {
    const folder = getDailyFolder(this.settings.rootFolder);
    const newPath = `${folder}/${formatChineseDateKey(date)}.md`;
    const oldPath = `${folder}/${formatDate(date)}.md`;
    return this.app.vault.getAbstractFileByPath(newPath) instanceof TFile ||
           this.app.vault.getAbstractFileByPath(oldPath) instanceof TFile;
  }

  async readDailyNote(date = new Date()) {
    const file = await this.getDailyFile(date);
    return parseDailyNote(await this.app.vault.read(file));
  }

  async saveDailyNote(date: Date, note: ParsedDailyNote) {
    const file = await this.getDailyFile(date);
    await this.app.vault.modify(file, renderDailyNote(date, note));
  }

  async appendRecord(content: string, time = formatTime(new Date()), date: Date = new Date()) {
    const note = await this.readDailyNote(date);
    const period = timePeriodFromTime(time);
    note.records[period].push({ time, content });
    note.records[period].sort((a, b) => a.time.localeCompare(b.time));
    await this.saveDailyNote(date, note);
  }

  async updateRecord(
    date: Date,
    sourcePeriod: TimePeriod,
    index: number,
    time: string,
    content: string
  ) {
    const note = await this.readDailyNote(date);
    const sourceRecords = note.records[sourcePeriod];
    const current = sourceRecords[index];
    if (!current) {
      throw new Error("Record not found");
    }
    sourceRecords.splice(index, 1);
    const targetPeriod = timePeriodFromTime(time);
    note.records[targetPeriod].push({ time, content });
    note.records.morning.sort((a, b) => a.time.localeCompare(b.time));
    note.records.afternoon.sort((a, b) => a.time.localeCompare(b.time));
    note.records.evening.sort((a, b) => a.time.localeCompare(b.time));
    await this.saveDailyNote(date, note);
  }

  async deleteRecord(date: Date, sourcePeriod: TimePeriod, index: number) {
    const note = await this.readDailyNote(date);
    const sourceRecords = note.records[sourcePeriod];
    if (!sourceRecords[index]) {
      throw new Error("Record not found");
    }
    sourceRecords.splice(index, 1);
    await this.saveDailyNote(date, note);
  }

  async ensureSummaryFolder(kind: "weekly" | "monthly") {
    const folder = kind === "weekly" ? getWeeklyFolder(this.settings.rootFolder) : getMonthlyFolder(this.settings.rootFolder);
    await ensureFolder(this.app, folder);
    return folder;
  }

  async writeSummaryFile(kind: "weekly" | "monthly", title: string, fileName: string, body: string) {
    const folder = await this.ensureSummaryFolder(kind);
    const content = previewSummaryContent(title, body);
    return await this.ensureSummaryFile(kind, folder, fileName, content);
  }

  async ensureSummaryFile(kind: "weekly" | "monthly", folder: string, fileName: string, content: string) {
    const path = `${folder}/${fileName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return file;
    }
    return await this.app.vault.create(path, content);
  }

  async polishSummary(file: TFile, kind: "weekly" | "monthly") {
    if (!this.settings.apiKey) {
      new Notice("Set API key first");
      return;
    }
    const source = await this.app.vault.read(file);
    const prompt = kind === "weekly"
      ? "Please polish this weekly summary into concise Chinese Markdown, keeping structure but making it more readable."
      : "Please polish this monthly summary into concise Chinese Markdown, keeping structure but making it more readable.";
    try {
      const response = await requestUrl({
        url: `${this.settings.aiBaseUrl.replace(/\/$/, "")}/chat/completions`,
        method: "POST",
        throw: false,
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify({
          model: normalizeAiModel(this.settings.aiModel),
          messages: [
            {
              role: "system",
              content: "You rewrite Markdown summaries in Chinese."
            },
            {
              role: "user",
              content: `${prompt}\n\n${source}`
            }
          ],
          temperature: 0.3
        })
      });
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.text}`);
      }
      const content = extractAiContent(response.text);
      if (!content) {
        throw new Error("AI returned an empty summary.");
      }
      await this.app.vault.modify(file, content.endsWith("\n") ? content : `${content}\n`);
      new Notice(`${kind === "weekly" ? "Weekly" : "Monthly"} summary polished`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`AI Summary failed: ${message}`);
      throw error;
    }
  }

  async generateSummaryBody(date: Date, entries: DailyNoteEntry[], kind: "weekly" | "monthly"): Promise<string> {
    if (entries.length === 0) {
      return `## Overview\n- No daily notes found for this ${kind === "weekly" ? "week" : "month"}.`;
    }
    if (!this.settings.apiKey) {
      return generateStructuredSummary(date, entries, kind);
    }
    try {
      const prompt = buildSummaryPrompt(date, entries, kind);
      const response = await requestUrl({
        url: `${this.settings.aiBaseUrl.replace(/\/$/, "")}/chat/completions`,
        method: "POST",
        throw: false,
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify({
          model: normalizeAiModel(this.settings.aiModel),
          messages: [
            {
              role: "system",
              content: "You write concise, insightful Chinese Markdown review summaries from daily notes."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.4
        })
      });
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.text}`);
      }
      const content = extractAiContent(response.text);
      if (!content) {
        throw new Error("AI returned an empty summary.");
      }
      return content.trim();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`AI ${kind} summary failed, using structured summary: ${message}`);
      return generateStructuredSummary(date, entries, kind);
    }
  }

  async generateWeeklySummary(date = new Date()) {
    const weekKey = getIsoWeekKey(date);
    const title = `${weekKey} Weekly Summary`;
    const range = getWeekRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = await this.generateSummaryBody(date, entries, "weekly");
    return await this.writeSummaryFile("weekly", title, weekKey, body);
  }

  async generateMonthlySummary(date = new Date()) {
    const monthKey = getMonthKey(date);
    const title = `${monthKey} Monthly Summary`;
    const range = getMonthRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = await this.generateSummaryBody(date, entries, "monthly");
    return await this.writeSummaryFile("monthly", title, monthKey, body);
  }

  async prepareWeeklySummaryPreview(date = new Date()) {
    const weekKey = getIsoWeekKey(date);
    const title = `${weekKey} Weekly Summary`;
    const range = getWeekRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = await this.generateSummaryBody(date, entries, "weekly");
    const folder = await this.ensureSummaryFolder("weekly");
    const file = await this.ensureSummaryFile("weekly", folder, weekKey, previewSummaryContent(title, body));
    await this.openPreview(title, file, body);
  }

  async prepareMonthlySummaryPreview(date = new Date()) {
    const monthKey = getMonthKey(date);
    const title = `${monthKey} Monthly Summary`;
    const range = getMonthRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = await this.generateSummaryBody(date, entries, "monthly");
    const folder = await this.ensureSummaryFolder("monthly");
    const file = await this.ensureSummaryFile("monthly", folder, monthKey, previewSummaryContent(title, body));
    await this.openPreview(title, file, body);
  }

  async createOrOpenTodayNote() {
    const file = await this.getDailyFile();
    await this.app.workspace.getLeaf(true).openFile(file);
    new Notice("Opened today note");
  }

  async regenerateSummary(date: Date = new Date()) {
    if (!this.settings.apiKey) {
      new Notice("Set API key first");
      return;
    }
    const note = await this.readDailyNote(date);
    const source = renderDailyNote(date, note);
    try {
      const response = await requestUrl({
        url: `${this.settings.aiBaseUrl.replace(/\/$/, "")}/chat/completions`,
        method: "POST",
        throw: false,
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`
        },
        body: JSON.stringify({
          model: normalizeAiModel(this.settings.aiModel),
          messages: [
            {
              role: "system",
              content: "You are a daily note assistant. Return only the summary text suitable for a Markdown summary section."
            },
            {
              role: "user",
              content: `Summarize today's note in Chinese.\n\n${source}`
            }
          ],
          temperature: 0.3
        })
      });
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.text}`);
      }
      const content = extractAiContent(response.text);
      if (!content) {
        throw new Error("AI returned an empty summary.");
      }
      note.summary = content;
      await this.saveDailyNote(date, note);
      new Notice("Summary updated");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`AI Summary failed: ${message}`);
      throw error;
    }
  }
}

class ConfirmModal extends Modal {
  private confirmed = false;
  private resolveFn: ((value: boolean) => void) | null = null;

  constructor(app: App, private message: string, private confirmText = "创建") {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.message });
    const row = contentEl.createDiv({ cls: "daily-note-flow-modal-actions" });
    const cancelBtn = row.createEl("button", { text: "取消" });
    const confirmBtn = row.createEl("button", { text: this.confirmText, cls: "mod-cta" });
    cancelBtn.onclick = () => { this.confirmed = false; this.close(); };
    confirmBtn.onclick = () => { this.confirmed = true; this.close(); };
  }

  onClose() {
    this.contentEl.empty();
    if (this.resolveFn) {
      this.resolveFn(this.confirmed);
      this.resolveFn = null;
    }
  }

  waitForConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }
}

class DailyNoteFlowView extends ItemView {
  private autosaveTimer: number | null = null;
  private saveStatusEl: HTMLElement | null = null;
  private getTasksFromDom: (() => string[]) | null = null;
  private getTodosFromDom: (() => string[]) | null = null;
  private summaryInputEl: HTMLTextAreaElement | null = null;
  private recordRefs: Array<{
    period: TimePeriod;
    timeInput: HTMLInputElement;
    contentInput: HTMLTextAreaElement;
  }> = [];
  private currentDate: Date = new Date();
  private selectedDate: Date | null = null;
  private calendarMonth: Date | null = null;
  private clockTimer: number | null = null;
  private clockEl: HTMLElement | null = null;
  private addTimeInputEl: HTMLInputElement | null = null;
  private userEditedTime: boolean = false;

  constructor(leaf: WorkspaceLeaf, private plugin: DailyNoteFlowPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Daily Note Flow";
  }

  async onOpen() {
    await this.renderView();
  }

  async onClose() {
    await this.flushAutoSave();
    this.stopClock();
  }

  private setSaveStatus(status: "saved" | "saving" | "unsaved" | "failed") {
    if (!this.saveStatusEl) return;
    const textMap = { saved: "Saved", saving: "Saving...", unsaved: "Unsaved", failed: "Save failed" };
    this.saveStatusEl.setText(textMap[status]);
    this.saveStatusEl.className = `daily-note-flow-save-status status-${status}`;
  }

  private collectCurrentNoteFromDom(): ParsedDailyNote {
    const note = createEmptyNote();
    note.tasks = this.getTasksFromDom ? this.getTasksFromDom() : [];
    note.todos = this.getTodosFromDom ? this.getTodosFromDom() : [];
    note.summary = this.summaryInputEl ? this.summaryInputEl.value.trim() : "";
    for (const ref of this.recordRefs) {
      if (!ref.contentInput.isConnected) continue;
      const content = ref.contentInput.value.trim();
      if (!content) continue;
      const period = timePeriodFromTime(ref.timeInput.value);
      note.records[period].push({ time: ref.timeInput.value, content });
    }
    for (const period of ["morning", "afternoon", "evening"] as TimePeriod[]) {
      note.records[period].sort((a, b) => a.time.localeCompare(b.time));
    }
    return note;
  }

  private scheduleAutoSave() {
    this.setSaveStatus("unsaved");
    if (this.autosaveTimer !== null) {
      window.clearTimeout(this.autosaveTimer);
    }
    this.autosaveTimer = window.setTimeout(() => {
      void this.doAutoSave();
    }, 800);
  }

  private async doAutoSave() {
    if (this.autosaveTimer !== null) {
      window.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.setSaveStatus("saving");
    try {
      const note = this.collectCurrentNoteFromDom();
      await this.plugin.saveDailyNote(this.currentDate, note);
      this.setSaveStatus("saved");
    } catch (error: unknown) {
      this.setSaveStatus("failed");
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Daily Note Flow] Auto-save failed:", error);
      new Notice(`Save failed: ${message}`);
    }
  }

  private async flushAutoSave() {
    if (this.autosaveTimer !== null) {
      await this.doAutoSave();
    }
  }

  private getDatesWithNotes(): Set<string> {
    const dates = new Set<string>();
    const folder = getDailyFolder(this.plugin.settings.rootFolder);
    const folderFile = this.plugin.app.vault.getAbstractFileByPath(folder);
    if (!folderFile || !(folderFile instanceof TFolder)) return dates;
    for (const child of folderFile.children as Array<TFile | TFolder>) {
      if (!(child instanceof TFile) || !child.path.endsWith(".md")) continue;
      dates.add(child.basename);
    }
    return dates;
  }

  private renderCalendar(container: Element) {
    if (!this.calendarMonth || !this.selectedDate) return;
    const section = container.createDiv({ cls: "daily-note-flow-section daily-note-flow-calendar" });
    const header = section.createDiv({ cls: "daily-note-flow-calendar-header" });

    const prevBtn = header.createEl("button", { text: "\u2039", cls: "daily-note-flow-calendar-nav" });
    prevBtn.onclick = () => {
      if (!this.calendarMonth) return;
      this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() - 1, 1);
      void this.renderView();
    };

    const title = header.createEl("span", { cls: "daily-note-flow-calendar-title" });
    title.setText(`${this.calendarMonth.getFullYear()}年${pad(this.calendarMonth.getMonth() + 1)}月`);

    const nextBtn = header.createEl("button", { text: "\u203a", cls: "daily-note-flow-calendar-nav" });
    nextBtn.onclick = () => {
      if (!this.calendarMonth) return;
      this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + 1, 1);
      void this.renderView();
    };

    const grid = section.createDiv({ cls: "daily-note-flow-calendar-grid" });
    const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
    for (const w of weekdays) {
      grid.createDiv({ cls: "daily-note-flow-calendar-weekday", text: w });
    }

    const noteDates = this.getDatesWithNotes();
    const year = this.calendarMonth.getFullYear();
    const month = this.calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startWeekday = (firstDay.getDay() + 6) % 7;

    for (let i = 0; i < startWeekday; i++) {
      grid.createDiv({ cls: "daily-note-flow-calendar-day empty" });
    }

    const today = new Date();
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const cellDate = new Date(year, month, d);
      const dayEl = grid.createDiv({ cls: "daily-note-flow-calendar-day" });
      dayEl.setText(String(d));

      if (cellDate.toDateString() === today.toDateString()) {
        dayEl.addClass("is-today");
      }
      if (cellDate.toDateString() === this.selectedDate.toDateString()) {
        dayEl.addClass("is-selected");
      }
      if (noteDates.has(formatDate(cellDate)) || noteDates.has(formatChineseDateKey(cellDate))) {
        dayEl.addClass("has-note");
      }

      dayEl.onclick = async () => {
        await this.flushAutoSave();
        if (!this.plugin.hasDailyNote(cellDate)) {
          const modal = new ConfirmModal(this.app, "这一天还没有日记，是否创建并补充记录？");
          modal.open();
          const confirmed = await modal.waitForConfirm();
          if (!confirmed) return;
        }
        this.selectedDate = cellDate;
        this.calendarMonth = new Date(year, month, 1);
        await this.renderView();
      };
    }
  }

  async renderView() {
    await this.flushAutoSave();

    const container = this.contentEl;
    container.empty();
    container.addClass("daily-note-flow-view");

    if (!this.selectedDate) this.selectedDate = new Date();
    if (!this.calendarMonth) {
      this.calendarMonth = new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), 1);
    }

    const date = this.selectedDate;
    this.currentDate = date;
    const note = await this.plugin.readDailyNote(date);

    this.recordRefs = [];

    this.renderCalendar(container);

    this.getTasksFromDom = createTaskListSection(
      container, "Daily Tasks", note.tasks,
      () => this.scheduleAutoSave(),
      () => { void this.doAutoSave(); }
    );
    this.getTodosFromDom = createTaskListSection(
      container, "Todos", note.todos,
      () => this.scheduleAutoSave(),
      () => { void this.doAutoSave(); }
    );

    const recordsSection = container.createDiv({ cls: "daily-note-flow-section" });
    const recordsHeader = recordsSection.createDiv({ cls: "daily-note-flow-section-header" });
    recordsHeader.createEl("h3", { text: "Records" });
    this.clockEl = recordsHeader.createEl("span", { cls: "daily-note-flow-clock", text: `Now: ${formatTime(new Date())}` });
    const addRow = recordsSection.createDiv({ cls: "daily-note-flow-record-row" });
    this.addTimeInputEl = addRow.createEl("input", { type: "time" });
    this.addTimeInputEl.value = formatTime(new Date());
    this.userEditedTime = false;
    this.addTimeInputEl.addEventListener("change", () => {
      this.userEditedTime = true;
    });
    const addContentInput = addRow.createEl("textarea", {
      cls: "daily-note-flow-grow daily-note-flow-record-textarea",
      placeholder: "Record content (Enter to add, Shift+Enter for newline)"
    });
    addContentInput.rows = 1;
    const addButton = addRow.createEl("button", { text: "Add" });
    const addRecord = async () => {
      if (!addContentInput.value.trim()) return;
      await this.flushAutoSave();
      await this.plugin.appendRecord(addContentInput.value.trim(), this.addTimeInputEl?.value || formatTime(new Date()), this.selectedDate ?? new Date());
      this.userEditedTime = false;
      await this.renderView();
    };
    addButton.onclick = addRecord;
    addContentInput.addEventListener("input", () => {
      this.scheduleAutoSave();
    });
    addContentInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void addRecord();
        return;
      }
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const start = addContentInput.selectionStart;
        const end = addContentInput.selectionEnd;
        const value = addContentInput.value;
        addContentInput.value = value.substring(0, start) + "\n" + value.substring(end);
        addContentInput.selectionStart = addContentInput.selectionEnd = start + 1;
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const start = addContentInput.selectionStart;
        const end = addContentInput.selectionEnd;
        const value = addContentInput.value;
        addContentInput.value = value.substring(0, start) + "### " + value.substring(end);
        addContentInput.selectionStart = addContentInput.selectionEnd = start + 4;
        this.scheduleAutoSave();
        return;
      }
    });
    for (const period of ["morning", "afternoon", "evening"] as TimePeriod[]) {
      const label = period === "morning" ? "Morning" : period === "afternoon" ? "Afternoon" : "Evening";
      const group = recordsSection.createDiv({ cls: "daily-note-flow-record" });
      group.createEl("strong", { text: label });
      note.records[period].forEach((record) => {
        const row = group.createDiv({ cls: "daily-note-flow-record-row" });
        const timeInput = row.createEl("input", { type: "time" });
        timeInput.value = record.time;
        const contentInput = row.createEl("textarea", {
          cls: "daily-note-flow-grow daily-note-flow-record-textarea",
          placeholder: "Record content"
        });
        contentInput.value = record.content;
        contentInput.rows = 1;

        this.recordRefs.push({ period, timeInput, contentInput });

        contentInput.addEventListener("input", () => {
          this.scheduleAutoSave();
        });
        contentInput.addEventListener("blur", () => { void this.flushAutoSave(); });
        contentInput.addEventListener("keydown", (e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            e.stopImmediatePropagation();
            const start = contentInput.selectionStart;
            const end = contentInput.selectionEnd;
            const value = contentInput.value;
            contentInput.value = value.substring(0, start) + "### " + value.substring(end);
            contentInput.selectionStart = contentInput.selectionEnd = start + 4;
            this.scheduleAutoSave();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopImmediatePropagation();
            const start = contentInput.selectionStart;
            const end = contentInput.selectionEnd;
            const value = contentInput.value;
            contentInput.value = value.substring(0, start) + "\n" + value.substring(end);
            contentInput.selectionStart = contentInput.selectionEnd = start + 1;
            this.scheduleAutoSave();
            return;
          }
        });

        let timeInputTimer: number | null = null;
        const applyTimeChange = () => {
          void (async () => {
            await this.doAutoSave();
            await this.renderView();
          })();
        };
        timeInput.addEventListener("input", () => {
          if (timeInputTimer !== null) window.clearTimeout(timeInputTimer);
          timeInputTimer = window.setTimeout(applyTimeChange, 250);
        });
        timeInput.addEventListener("change", () => {
          if (timeInputTimer !== null) {
            window.clearTimeout(timeInputTimer);
            timeInputTimer = null;
          }
          applyTimeChange();
        });

        const deleteRecordButton = row.createEl("button", { text: "Delete" });
        deleteRecordButton.onclick = async () => {
          await this.flushAutoSave();
          const idx = this.recordRefs.findIndex((r) => r.timeInput === timeInput && r.contentInput === contentInput);
          if (idx >= 0) this.recordRefs.splice(idx, 1);
          row.remove();
          await this.doAutoSave();
          await this.renderView();
        };
      });
      if (note.records[period].length === 0) {
        group.createDiv({ cls: "daily-note-flow-muted", text: "No records yet." });
      }
    }

    const summarySection = container.createDiv({ cls: "daily-note-flow-section" });
    summarySection.createEl("h3", { text: "Summary" });
    this.summaryInputEl = summarySection.createEl("textarea", { cls: "daily-note-flow-textarea" });
    this.summaryInputEl.value = note.summary;
    this.summaryInputEl.addEventListener("input", () => { this.scheduleAutoSave(); });
    this.summaryInputEl.addEventListener("blur", () => { void this.flushAutoSave(); });

    const actions = container.createDiv({ cls: "daily-note-flow-actions" });
    this.saveStatusEl = actions.createEl("span", { cls: "daily-note-flow-save-status status-saved", text: "Saved" });
    const saveButton = actions.createEl("button", { text: "Save" });
    saveButton.onclick = async () => {
      await this.doAutoSave();
      new Notice("Saved");
    };
    const openButton = actions.createEl("button", { text: "Open Today" });
    openButton.onclick = async () => {
      await this.flushAutoSave();
      this.selectedDate = new Date();
      this.calendarMonth = new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), 1);
      await this.renderView();
      await this.plugin.createOrOpenTodayNote();
    };
    const aiButton = actions.createEl("button", { text: "AI Summary" });
    aiButton.onclick = async () => {
      await this.flushAutoSave();
      await this.plugin.regenerateSummary(this.selectedDate ?? new Date());
      await this.renderView();
    };
    const reviewsButton = actions.createEl("button", { text: "Reviews" });
    reviewsButton.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("Weekly Summary").onClick(() => {
          void this.plugin.prepareWeeklySummaryPreview(date);
        })
      );
      menu.addItem((item) =>
        item.setTitle("Monthly Summary").onClick(() => {
          void this.plugin.prepareMonthlySummaryPreview(date);
        })
      );
      menu.showAtMouseEvent(e);
    });
    this.startClock();
  }

  private startClock() {
    this.stopClock();
    this.updateClock();
    this.clockTimer = window.setInterval(() => {
      this.updateClock();
    }, 1000);
  }

  private stopClock() {
    if (this.clockTimer !== null) {
      window.clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private updateClock() {
    const now = new Date();
    const timeStr = formatTime(now);
    if (this.clockEl) {
      this.clockEl.setText(`Now: ${timeStr}`);
    }
    if (this.addTimeInputEl && !this.userEditedTime) {
      this.addTimeInputEl.value = timeStr;
    }
  }
}

class DailyNoteFlowPreviewView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: DailyNoteFlowPlugin) {
    super(leaf);
  }

  getViewType() {
    return PREVIEW_VIEW_TYPE;
  }

  getDisplayText() {
    return "Daily Note Preview";
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("daily-note-flow-view");
    const state = this.plugin.summaryPreviewState;
    if (!state) {
      container.createEl("p", { text: "No preview data." });
      return;
    }

    container.createEl("h3", { text: state.title });
    const preview = container.createEl("textarea", { cls: "daily-note-flow-textarea" });
    preview.value = previewSummaryContent(state.title, state.body);

    const actions = container.createDiv({ cls: "daily-note-flow-actions" });
    const applyButton = actions.createEl("button", { text: "Apply" });
    applyButton.onclick = async () => {
      await this.plugin.app.vault.modify(state.file, preview.value.endsWith("\n") ? preview.value : `${preview.value}\n`);
      new Notice("Summary applied");
      await this.plugin.app.workspace.getLeaf(true).openFile(state.file);
    };
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    cancelButton.onclick = async () => {
      this.plugin.summaryPreviewState = null;
      await this.app.workspace.getLeaf(true).openFile(state.file);
    };
  }
}

class DailyNoteFlowSettingTab extends PluginSettingTab {
  private activeTab: "tasks" | "api" = "tasks";

  constructor(app: App, private plugin: DailyNoteFlowPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions() {
    return [];
  }

  display(): void {
    this.renderSettings();
  }

  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    const tabBar = containerEl.createDiv({ cls: "daily-note-flow-settings-tabs" });
    const tasksTab = tabBar.createEl("button", { text: "Daily Tasks", cls: "daily-note-flow-settings-tab" });
    const apiTab = tabBar.createEl("button", { text: "API", cls: "daily-note-flow-settings-tab" });

    const updateTabStyles = () => {
      tasksTab.toggleClass("is-active", this.activeTab === "tasks");
      apiTab.toggleClass("is-active", this.activeTab === "api");
    };

    tasksTab.onclick = () => {
      this.activeTab = "tasks";
      this.renderSettings();
    };
    apiTab.onclick = () => {
      this.activeTab = "api";
      this.renderSettings();
    };
    updateTabStyles();

    const content = containerEl.createDiv({ cls: "daily-note-flow-settings-content" });

    if (this.activeTab === "tasks") {
      this.renderTasksTab(content);
    } else {
      this.renderApiTab(content);
    }
  }

  private renderTasksTab(container: HTMLElement) {
    new Setting(container)
      .setName("Daily Task Templates")
      .setHeading();
    container.createEl("p", { text: "Tasks defined here will be automatically added to new daily notes based on their schedule.", cls: "setting-item-description" });

    const templates = this.plugin.settings.taskTemplates;
    for (let i = 0; i < templates.length; i++) {
      this.renderTaskTemplateRow(container, i);
    }

    const addBtn = container.createEl("button", { text: "+ Add Task Template", cls: "mod-cta daily-note-flow-task-template-add" });
    addBtn.onclick = async () => {
      const newTemplate: TaskTemplate = {
        id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: "",
        enabled: true,
        scheduleType: "daily",
        weekdays: [1, 2, 3, 4, 5],
        intervalDays: 1,
        startDate: formatDate(new Date())
      };
      this.plugin.settings.taskTemplates.push(newTemplate);
      await this.plugin.saveSettings();
      this.renderSettings();
    };
  }

  private renderTaskTemplateRow(container: HTMLElement, index: number) {
    const tpl = this.plugin.settings.taskTemplates[index];
    const row = container.createDiv({ cls: "daily-note-flow-task-template-row" });

    const topRow = row.createDiv({ cls: "daily-note-flow-task-template-top" });

    const toggle = topRow.createEl("input", { type: "checkbox" });
    toggle.checked = tpl.enabled;
    toggle.onchange = () => {
      void (async () => {
        tpl.enabled = toggle.checked;
        await this.plugin.saveSettings();
      })();
    };

    const titleInput = topRow.createEl("input", {
      type: "text",
      cls: "daily-note-flow-task-template-title",
      value: tpl.title,
      placeholder: "Task title..."
    });
    titleInput.addEventListener("change", () => {
      void (async () => {
        tpl.title = titleInput.value.trim();
        await this.plugin.saveSettings();
      })();
    });

    const delBtn = topRow.createEl("button", { text: "×", cls: "daily-note-flow-task-template-delete" });
    delBtn.onclick = async () => {
      this.plugin.settings.taskTemplates.splice(index, 1);
      await this.plugin.saveSettings();
      this.renderSettings();
    };

    const bottomRow = row.createDiv({ cls: "daily-note-flow-task-template-bottom" });

    const scheduleSelect = bottomRow.createEl("select");
    for (const opt of [
      { value: "daily", label: "Every day" },
      { value: "workdays", label: "Workdays (Mon-Fri)" },
      { value: "weekly", label: "Specific weekdays" },
      { value: "interval", label: "Every N days" }
    ]) {
      const o = scheduleSelect.createEl("option", { value: opt.value, text: opt.label });
      if (opt.value === tpl.scheduleType) o.selected = true;
    }
    scheduleSelect.onchange = () => {
      void (async () => {
        tpl.scheduleType = scheduleSelect.value as ScheduleType;
        await this.plugin.saveSettings();
        this.renderSettings();
      })();
    };

    if (tpl.scheduleType === "weekly") {
      const weekdayRow = bottomRow.createDiv({ cls: "daily-note-flow-weekday-row" });
      const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      for (let d = 0; d < 7; d++) {
        const label = weekdayRow.createEl("label", { cls: "daily-note-flow-weekday-label" });
        const cb = label.createEl("input", { type: "checkbox" });
        cb.checked = tpl.weekdays.includes(d);
        cb.onchange = () => {
          void (async () => {
            if (cb.checked) {
              if (!tpl.weekdays.includes(d)) tpl.weekdays.push(d);
            } else {
              tpl.weekdays = tpl.weekdays.filter((w) => w !== d);
            }
            await this.plugin.saveSettings();
          })();
        };
        label.createSpan({ text: dayLabels[d] });
      }
    }

    if (tpl.scheduleType === "interval") {
      const intervalRow = bottomRow.createDiv({ cls: "daily-note-flow-interval-row" });
      intervalRow.createSpan({ text: "Every" });
      const intervalInput = intervalRow.createEl("input", { type: "number", cls: "daily-note-flow-interval-input", value: String(tpl.intervalDays || 1) });
      intervalInput.min = "1";
      intervalInput.onchange = () => {
        void (async () => {
          tpl.intervalDays = Math.max(1, parseInt(intervalInput.value, 10) || 1);
          await this.plugin.saveSettings();
        })();
      };
      intervalRow.createSpan({ text: "days, starting" });
      const startInput = intervalRow.createEl("input", { type: "date", value: tpl.startDate || formatDate(new Date()) });
      startInput.onchange = () => {
        void (async () => {
          tpl.startDate = startInput.value;
          await this.plugin.saveSettings();
        })();
      };
    }
  }

  private renderApiTab(container: HTMLElement) {
    new Setting(container)
      .setName("Root folder")
      .setDesc("Folder inside your Obsidian vault.")
      .addText((text) =>
        text
          .setPlaceholder("Daliy_Note")
          .setValue(this.plugin.settings.rootFolder)
          .onChange(async (value) => {
            this.plugin.settings.rootFolder = value.trim() || "Daliy_Note";
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("API key")
      .setDesc("API key for your AI provider.")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("API base URL")
      .setDesc("Base URL for the AI API endpoint.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.aiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.aiBaseUrl = value.trim() || "https://api.deepseek.com";
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName("AI model")
      .setDesc("Model name to use for AI summaries.")
      .addText((text) =>
        text
          .setValue(normalizeAiModel(this.plugin.settings.aiModel))
          .onChange(async (value) => {
            this.plugin.settings.aiModel = normalizeAiModel(value);
            await this.plugin.saveSettings();
          })
      );
  }
}
