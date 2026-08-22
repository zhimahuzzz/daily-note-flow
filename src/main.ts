import {
  App,
  ItemView,
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
  deepseekApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
}

interface DailyRecord {
  time: string;
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
  deepseekApiKey: "",
  aiBaseUrl: "https://api.deepseek.com",
  aiModel: "deepseek-v4-flash"
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
  const parts = key.split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatTaskLine(line: string) {
  return line.startsWith("- ") ? line : `- ${line}`;
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
  const match = /^-\s+(?<time>\d{2}:\d{2})\s*(?<content>.*)$/.exec(line);
  if (!match?.groups) return null;
  return {
    time: match.groups.time,
    content: match.groups.content.trim()
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

function renderDailyNote(date: Date, parsed: ParsedDailyNote) {
  const lines: string[] = [];
  lines.push(`# ${formatDate(date)} Daily Note`);
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
      lines.push(content ? `- ${item.time} ${content}` : `- ${item.time}`);
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

  for (const rawLine of lines as string[]) {
    const line: string = rawLine.trimEnd();
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
    if (section === "records" && recordPeriod && line.startsWith("- ")) {
      const record = parseRecordLine(line);
      if (record) note.records[recordPeriod].push(record);
      continue;
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
    const stored = await this.loadData() as Partial<DailyNoteFlowSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
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
    const path = `${folder}/${formatDate(date)}.md`;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      await ensureFolder(this.app, folder);
      file = await this.app.vault.create(path, renderDailyNote(date, createEmptyNote()));
    }
    if (!(file instanceof TFile)) {
      throw new Error(`Unable to create daily note at ${path}`);
    }
    return file;
  }

  async readDailyNote(date = new Date()) {
    const file = await this.getDailyFile(date);
    return parseDailyNote(await this.app.vault.read(file));
  }

  async saveDailyNote(date: Date, note: ParsedDailyNote) {
    const file = await this.getDailyFile(date);
    await this.app.vault.modify(file, renderDailyNote(date, note));
  }

  async appendRecord(content: string, time = formatTime(new Date())) {
    const date = new Date();
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
    if (!this.settings.deepseekApiKey) {
      new Notice("Set DeepSeek API key first");
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
          Authorization: `Bearer ${this.settings.deepseekApiKey}`
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
        throw new Error("DeepSeek returned an empty summary.");
      }
      await this.app.vault.modify(file, content.endsWith("\n") ? content : `${content}\n`);
      new Notice(`${kind === "weekly" ? "Weekly" : "Monthly"} summary polished`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`AI Summary failed: ${message}`);
      throw error;
    }
  }

  async generateWeeklySummary(date = new Date()) {
    const weekKey = getIsoWeekKey(date);
    const title = `${weekKey} Weekly Summary`;
    const range = getWeekRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = renderWeeklySummary(date, entries);
    return await this.writeSummaryFile("weekly", title, weekKey, body);
  }

  async generateMonthlySummary(date = new Date()) {
    const monthKey = getMonthKey(date);
    const title = `${monthKey} Monthly Summary`;
    const range = getMonthRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = renderMonthlySummary(date, entries);
    return await this.writeSummaryFile("monthly", title, monthKey, body);
  }

  async prepareWeeklySummaryPreview(date = new Date()) {
    const weekKey = getIsoWeekKey(date);
    const title = `${weekKey} Weekly Summary`;
    const range = getWeekRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = renderWeeklySummary(date, entries);
    const folder = await this.ensureSummaryFolder("weekly");
    const file = await this.ensureSummaryFile("weekly", folder, weekKey, previewSummaryContent(title, body));
    await this.openPreview(title, file, body);
  }

  async prepareMonthlySummaryPreview(date = new Date()) {
    const monthKey = getMonthKey(date);
    const title = `${monthKey} Monthly Summary`;
    const range = getMonthRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = renderMonthlySummary(date, entries);
    const folder = await this.ensureSummaryFolder("monthly");
    const file = await this.ensureSummaryFile("monthly", folder, monthKey, previewSummaryContent(title, body));
    await this.openPreview(title, file, body);
  }

  async createOrOpenTodayNote() {
    const file = await this.getDailyFile();
    await this.app.workspace.getLeaf(true).openFile(file);
    new Notice("Opened today note");
  }

  async regenerateSummary() {
    if (!this.settings.deepseekApiKey) {
      new Notice("Set DeepSeek API key first");
      return;
    }
    const date = new Date();
    const note = await this.readDailyNote(date);
    const source = renderDailyNote(date, note);
    try {
      const response = await requestUrl({
        url: `${this.settings.aiBaseUrl.replace(/\/$/, "")}/chat/completions`,
        method: "POST",
        throw: false,
        contentType: "application/json",
        headers: {
          Authorization: `Bearer ${this.settings.deepseekApiKey}`
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
        throw new Error("DeepSeek returned an empty summary.");
      }
      note.summary = content;
      await this.saveDailyNote(date, note);
      new Notice("Summary updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`AI Summary failed: ${message}`);
      throw error;
    }
  }
}

class DailyNoteFlowView extends ItemView {
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

  async renderView() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("daily-note-flow-view");

    const date = new Date();
    const note = await this.plugin.readDailyNote(date);

    const taskSection = container.createDiv({ cls: "daily-note-flow-section" });
    taskSection.createEl("h3", { text: "Daily Tasks / Todos" });
    const tasksInput = taskSection.createEl("textarea", { cls: "daily-note-flow-textarea" });
    tasksInput.value = note.tasks.join("\n");
    const todosInput = taskSection.createEl("textarea", { cls: "daily-note-flow-textarea" });
    todosInput.value = note.todos.join("\n");

    const recordsSection = container.createDiv({ cls: "daily-note-flow-section" });
    recordsSection.createEl("h3", { text: "Records" });
    const addRow = recordsSection.createDiv({ cls: "daily-note-flow-record-row" });
    const addTimeInput = addRow.createEl("input", { type: "time" });
    addTimeInput.value = formatTime(new Date());
    const addContentInput = addRow.createEl("input", {
      type: "text",
      cls: "daily-note-flow-grow",
      placeholder: "Record content"
    });
    const addButton = addRow.createEl("button", { text: "Add" });
    addButton.onclick = async () => {
      if (!addContentInput.value.trim()) return;
      await this.plugin.appendRecord(addContentInput.value.trim(), addTimeInput.value);
      await this.renderView();
    };
    for (const period of ["morning", "afternoon", "evening"] as TimePeriod[]) {
      const label = period === "morning" ? "Morning" : period === "afternoon" ? "Afternoon" : "Evening";
      const group = recordsSection.createDiv({ cls: "daily-note-flow-record" });
      group.createEl("strong", { text: label });
      note.records[period].forEach((record, index) => {
        const row = group.createDiv({ cls: "daily-note-flow-record-row" });
        const timeInput = row.createEl("input", { type: "time" });
        timeInput.value = record.time;
        const contentInput = row.createEl("input", {
          type: "text",
          cls: "daily-note-flow-grow",
          placeholder: "Record content"
        });
        contentInput.value = record.content;
        const saveRecordButton = row.createEl("button", { text: "Save" });
        saveRecordButton.onclick = async () => {
          if (!contentInput.value.trim()) return;
          await this.plugin.updateRecord(date, period, index, timeInput.value, contentInput.value.trim());
          await this.renderView();
        };
        const deleteRecordButton = row.createEl("button", { text: "Delete" });
        deleteRecordButton.onclick = async () => {
          await this.plugin.deleteRecord(date, period, index);
          await this.renderView();
        };
      });
      if (note.records[period].length === 0) {
        group.createDiv({ cls: "daily-note-flow-muted", text: "No records yet." });
      }
    }

    const summarySection = container.createDiv({ cls: "daily-note-flow-section" });
    summarySection.createEl("h3", { text: "Summary" });
    const summaryInput = summarySection.createEl("textarea", { cls: "daily-note-flow-textarea" });
    summaryInput.value = note.summary;

    const actions = container.createDiv({ cls: "daily-note-flow-actions" });
    const saveButton = actions.createEl("button", { text: "Save" });
    saveButton.onclick = async () => {
      note.tasks = tasksInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      note.todos = todosInput.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      note.summary = summaryInput.value.trim();
      await this.plugin.saveDailyNote(date, note);
      new Notice("Saved");
      await this.renderView();
    };
    const openButton = actions.createEl("button", { text: "Open Today" });
    openButton.onclick = async () => this.plugin.createOrOpenTodayNote();
    const aiButton = actions.createEl("button", { text: "AI Summary" });
    aiButton.onclick = async () => {
      await this.plugin.regenerateSummary();
      await this.renderView();
    };
    const weekButton = actions.createEl("button", { text: "Weekly Summary" });
    weekButton.onclick = async () => {
      await this.plugin.prepareWeeklySummaryPreview(date);
    };
    const weekAiButton = actions.createEl("button", { text: "AI Weekly" });
    weekAiButton.onclick = async () => {
      await this.plugin.prepareWeeklySummaryPreview(date);
    };
    const monthButton = actions.createEl("button", { text: "Monthly Summary" });
    monthButton.onclick = async () => {
      await this.plugin.prepareMonthlySummaryPreview(date);
    };
    const monthAiButton = actions.createEl("button", { text: "AI Monthly" });
    monthAiButton.onclick = async () => {
      await this.plugin.prepareMonthlySummaryPreview(date);
    };
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
    const container = this.containerEl.children[1];
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
  constructor(app: App, private plugin: DailyNoteFlowPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions() {
    return [];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
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

    new Setting(containerEl)
      .setName("DeepSeek API key")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.deepseekApiKey)
          .onChange(async (value) => {
            this.plugin.settings.deepseekApiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("AI base URL")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.aiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.aiBaseUrl = value.trim() || "https://api.deepseek.com";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("AI model")
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
