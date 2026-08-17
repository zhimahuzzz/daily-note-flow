/* Daily Note Flow for Obsidian */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => DailyNoteFlowPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE = "daily-note-flow-view";
var PREVIEW_VIEW_TYPE = "daily-note-flow-preview-view";
var DEFAULT_SETTINGS = {
  rootFolder: "Daliy_Note",
  deepseekApiKey: "",
  aiBaseUrl: "https://api.deepseek.com",
  aiModel: "deepseek-v4-flash"
};
function normalizeAiModel(value) {
  const model = value.trim();
  if (!model || model === "deepseek-v3") return "deepseek-v4-flash";
  return model;
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function getIsoWeekKey(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  return `${target.getUTCFullYear()}-W${pad(week)}`;
}
function getMonthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}
function getMonthRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end };
}
function getWeekRange(date) {
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
function isDateInRange(date, start, end) {
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}
function parseDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}
function formatTaskLine(line) {
  return line.startsWith("- ") ? line : `- ${line}`;
}
function formatRecordLines(records) {
  return records.map((record) => `- ${record.time} ${record.content}`.trimEnd());
}
function timePeriodFromTime(time) {
  var _a;
  const hour = Number((_a = time.split(":")[0]) != null ? _a : "0");
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
function isHeading(line, level, title) {
  return line.startsWith(`${"#".repeat(level)} ${title}`);
}
function ensureFolderPath(folderPath) {
  return folderPath.replace(/\/+$/g, "").trim();
}
function getDailyFolder(rootFolder) {
  return `${ensureFolderPath(rootFolder)}/Daily`;
}
function getWeeklyFolder(rootFolder) {
  return `${ensureFolderPath(rootFolder)}/Weekly`;
}
function getMonthlyFolder(rootFolder) {
  return `${ensureFolderPath(rootFolder)}/Monthly`;
}
function createEmptyNote(date) {
  return {
    tasks: [],
    todos: [],
    records: { morning: [], afternoon: [], evening: [] },
    summary: ""
  };
}
function renderDailyNote(date, parsed) {
  const lines = [];
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
  for (const period of ["morning", "afternoon", "evening"]) {
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
function parseDailyNote(content) {
  const note = createEmptyNote(/* @__PURE__ */ new Date());
  const lines = content.split(/\r?\n/);
  let section = "";
  let recordPeriod = null;
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
    if (section === "records" && recordPeriod && line.startsWith("- ")) {
      const match = line.match(/^\-\s+(\d{2}:\d{2})\s*(.*)$/);
      if (match) {
        note.records[recordPeriod].push({
          time: match[1],
          content: match[2].trim()
        });
      }
      continue;
    }
    if (section === "summary") {
      note.summary = `${note.summary}
${line}`.trim();
    }
  }
  return note;
}
async function ensureFolder(app, folderPath) {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!folder) {
    await app.vault.createFolder(folderPath);
  }
}
async function listDailyEntries(app, rootFolder, start, end) {
  const entries = [];
  const folder = getDailyFolder(rootFolder);
  const folderFile = app.vault.getAbstractFileByPath(folder);
  if (!folderFile || !(folderFile instanceof import_obsidian.TFolder)) {
    return entries;
  }
  for (const child of folderFile.children) {
    if (!(child instanceof import_obsidian.TFile) || !child.path.endsWith(".md")) continue;
    const baseName = child.basename;
    const date = parseDateKey(baseName);
    if (!date || !isDateInRange(date, start, end)) continue;
    const note = parseDailyNote(await app.vault.read(child));
    entries.push({ date, key: baseName, note });
  }
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  return entries;
}
function renderWeeklySummary(date, entries) {
  const lines = [];
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
    for (const period of ["morning", "afternoon", "evening"]) {
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
function renderMonthlySummary(date, entries) {
  const lines = [];
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
    for (const period of ["morning", "afternoon", "evening"]) {
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
function previewSummaryContent(title, body) {
  return `# ${title}

${body.trim()}
`;
}
var DailyNoteFlowPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.summaryPreviewState = null;
  }
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new DailyNoteFlowView(leaf, this));
    this.registerView(PREVIEW_VIEW_TYPE, (leaf) => new DailyNoteFlowPreviewView(leaf, this));
    this.addRibbonIcon("notebook-pen", "Daily Note Flow", () => {
      void this.openPanel();
    });
    this.addCommand({
      id: "open-daily-note-flow",
      name: "Open Daily Note Flow",
      callback: () => void this.openPanel()
    });
    this.addSettingTab(new DailyNoteFlowSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async openPanel() {
    var _a;
    const leaf = (_a = this.app.workspace.getLeftLeaf(false)) != null ? _a : this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  async openPreview(title, file, body) {
    var _a;
    this.summaryPreviewState = { title, file, body };
    const leaf = (_a = this.app.workspace.getRightLeaf(false)) != null ? _a : this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: PREVIEW_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  async getDailyFile(date = /* @__PURE__ */ new Date()) {
    const folder = getDailyFolder(this.settings.rootFolder);
    const path = `${folder}/${formatDate(date)}.md`;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian.TFile)) {
      await ensureFolder(this.app, folder);
      file = await this.app.vault.create(path, renderDailyNote(date, createEmptyNote(date)));
    }
    if (!(file instanceof import_obsidian.TFile)) {
      throw new Error(`Unable to create daily note at ${path}`);
    }
    return file;
  }
  async readDailyNote(date = /* @__PURE__ */ new Date()) {
    const file = await this.getDailyFile(date);
    return parseDailyNote(await this.app.vault.read(file));
  }
  async saveDailyNote(date, note) {
    const file = await this.getDailyFile(date);
    await this.app.vault.modify(file, renderDailyNote(date, note));
  }
  async appendRecord(content, time = formatTime(/* @__PURE__ */ new Date())) {
    const date = /* @__PURE__ */ new Date();
    const note = await this.readDailyNote(date);
    const period = timePeriodFromTime(time);
    note.records[period].push({ time, content });
    note.records[period].sort((a, b) => a.time.localeCompare(b.time));
    await this.saveDailyNote(date, note);
  }
  async updateRecord(date, sourcePeriod, index, time, content) {
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
  async deleteRecord(date, sourcePeriod, index) {
    const note = await this.readDailyNote(date);
    const sourceRecords = note.records[sourcePeriod];
    if (!sourceRecords[index]) {
      throw new Error("Record not found");
    }
    sourceRecords.splice(index, 1);
    await this.saveDailyNote(date, note);
  }
  async ensureSummaryFolder(kind) {
    const folder = kind === "weekly" ? getWeeklyFolder(this.settings.rootFolder) : getMonthlyFolder(this.settings.rootFolder);
    await ensureFolder(this.app, folder);
    return folder;
  }
  async writeSummaryFile(kind, title, fileName, body) {
    const folder = await this.ensureSummaryFolder(kind);
    const content = previewSummaryContent(title, body);
    return await this.ensureSummaryFile(kind, folder, fileName, content);
  }
  async ensureSummaryFile(kind, folder, fileName, content) {
    const path = `${folder}/${fileName}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof import_obsidian.TFile) {
      await this.app.vault.modify(file, content);
      return file;
    }
    return await this.app.vault.create(path, content);
  }
  async polishSummary(file, kind) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!this.settings.deepseekApiKey) {
      new import_obsidian.Notice("Set DeepSeek API key first");
      return;
    }
    const source = await this.app.vault.read(file);
    const prompt = kind === "weekly" ? "Please polish this weekly summary into concise Chinese Markdown, keeping structure but making it more readable." : "Please polish this monthly summary into concise Chinese Markdown, keeping structure but making it more readable.";
    try {
      const response = await (0, import_obsidian.requestUrl)({
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
              content: `${prompt}

${source}`
            }
          ],
          temperature: 0.3
        })
      });
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.text || JSON.stringify(response.json)}`);
      }
      const json = (_a = response.json) != null ? _a : JSON.parse(response.text);
      const content = (_g = (_f = (_e = (_d = (_c = (_b = json == null ? void 0 : json.choices) == null ? void 0 : _b[0]) == null ? void 0 : _c.message) == null ? void 0 : _d.content) == null ? void 0 : _e.trim) == null ? void 0 : _f.call(_e)) != null ? _g : "";
      if (!content) {
        throw new Error("DeepSeek returned an empty summary.");
      }
      await this.app.vault.modify(file, content.endsWith("\n") ? content : `${content}
`);
      new import_obsidian.Notice(`${kind === "weekly" ? "Weekly" : "Monthly"} summary polished`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian.Notice(`AI Summary failed: ${message}`);
      throw error;
    }
  }
  async generateWeeklySummary(date = /* @__PURE__ */ new Date()) {
    const weekKey = getIsoWeekKey(date);
    const title = `${weekKey} Weekly Summary`;
    const range = getWeekRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = renderWeeklySummary(date, entries);
    return await this.writeSummaryFile("weekly", title, weekKey, body);
  }
  async generateMonthlySummary(date = /* @__PURE__ */ new Date()) {
    const monthKey = getMonthKey(date);
    const title = `${monthKey} Monthly Summary`;
    const range = getMonthRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = renderMonthlySummary(date, entries);
    return await this.writeSummaryFile("monthly", title, monthKey, body);
  }
  async prepareWeeklySummaryPreview(date = /* @__PURE__ */ new Date()) {
    const weekKey = getIsoWeekKey(date);
    const title = `${weekKey} Weekly Summary`;
    const range = getWeekRange(date);
    const entries = await listDailyEntries(this.app, this.settings.rootFolder, range.start, range.end);
    const body = renderWeeklySummary(date, entries);
    const folder = await this.ensureSummaryFolder("weekly");
    const file = await this.ensureSummaryFile("weekly", folder, weekKey, previewSummaryContent(title, body));
    await this.openPreview(title, file, body);
  }
  async prepareMonthlySummaryPreview(date = /* @__PURE__ */ new Date()) {
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
    new import_obsidian.Notice("Opened today note");
  }
  async regenerateSummary() {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!this.settings.deepseekApiKey) {
      new import_obsidian.Notice("Set DeepSeek API key first");
      return;
    }
    const date = /* @__PURE__ */ new Date();
    const note = await this.readDailyNote(date);
    const source = renderDailyNote(date, note);
    try {
      const response = await (0, import_obsidian.requestUrl)({
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
              content: `Summarize today's note in Chinese.

${source}`
            }
          ],
          temperature: 0.3
        })
      });
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.text || JSON.stringify(response.json)}`);
      }
      const json = (_a = response.json) != null ? _a : JSON.parse(response.text);
      const content = (_g = (_f = (_e = (_d = (_c = (_b = json == null ? void 0 : json.choices) == null ? void 0 : _b[0]) == null ? void 0 : _c.message) == null ? void 0 : _d.content) == null ? void 0 : _e.trim) == null ? void 0 : _f.call(_e)) != null ? _g : "";
      if (!content) {
        throw new Error("DeepSeek returned an empty summary.");
      }
      note.summary = content;
      await this.saveDailyNote(date, note);
      new import_obsidian.Notice("Summary updated");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian.Notice(`AI Summary failed: ${message}`);
      throw error;
    }
  }
};
var DailyNoteFlowView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
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
    const date = /* @__PURE__ */ new Date();
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
    addTimeInput.value = formatTime(/* @__PURE__ */ new Date());
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
    for (const period of ["morning", "afternoon", "evening"]) {
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
        group.createEl("div", { cls: "daily-note-flow-muted", text: "No records yet." });
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
      new import_obsidian.Notice("Saved");
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
};
var DailyNoteFlowPreviewView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
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
      await this.plugin.app.vault.modify(state.file, preview.value.endsWith("\n") ? preview.value : `${preview.value}
`);
      new import_obsidian.Notice("Summary applied");
      await this.plugin.app.workspace.getLeaf(true).openFile(state.file);
    };
    const cancelButton = actions.createEl("button", { text: "Cancel" });
    cancelButton.onclick = async () => {
      this.plugin.summaryPreviewState = null;
      await this.app.workspace.getLeaf(true).openFile(state.file);
    };
  }
};
var DailyNoteFlowSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Daily Note Flow" });
    new import_obsidian.Setting(containerEl).setName("Root folder").setDesc("Folder inside your Obsidian vault.").addText(
      (text) => text.setPlaceholder("Daliy_Note").setValue(this.plugin.settings.rootFolder).onChange(async (value) => {
        this.plugin.settings.rootFolder = value.trim() || "Daliy_Note";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("DeepSeek API key").addText(
      (text) => text.setPlaceholder("sk-...").setValue(this.plugin.settings.deepseekApiKey).onChange(async (value) => {
        this.plugin.settings.deepseekApiKey = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("AI base URL").addText(
      (text) => text.setValue(this.plugin.settings.aiBaseUrl).onChange(async (value) => {
        this.plugin.settings.aiBaseUrl = value.trim() || "https://api.deepseek.com";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("AI model").addText(
      (text) => text.setValue(normalizeAiModel(this.plugin.settings.aiModel)).onChange(async (value) => {
        this.plugin.settings.aiModel = normalizeAiModel(value);
        await this.plugin.saveSettings();
      })
    );
  }
};
