import {
  getQuestionCount,
  getQuestions,
  getQuestionsCached,
  getRandomQuestionsByLevel,
  getCurrentAuthUser,
  hasSupabaseConfig,
  normalizeQuestionRow,
  resolveUserId,
  signInWithPassword,
  signOutUser,
  signUpWithPassword,
  supabaseClient,
} from "./supabase.js";

const { createApp, computed, onMounted, ref } = Vue;

const LEVELS = [
  { value: "junior", label: "初级" },
  { value: "middle", label: "中级" },
  { value: "senior", label: "高级" },
  { value: "technician", label: "技师" },
  { value: "senior_technician", label: "高级技师" },
];

const COMMON_LEVEL_KEYS = ["common", "通用", "通用基础知识"];

const QUESTION_TYPES = [
  { value: "single", label: "单选" },
  { value: "multiple", label: "多选" },
  { value: "judge", label: "判断" },
  { value: "practical", label: "实操" },
];

const IMPORT_FILE_EXTENSIONS = new Set(["doc", "docx", "txt"]);
const INSERT_BATCH_SIZE = 200;
const EXAM_RULE = {
  single: 80,
  multiple: 10,
  judge: 10,
  minutes: 60,
  passScore: 60,
};

const CONFIG = window.APP_CONFIG || {};
const AI_ANALYSIS_ENABLED = Boolean(CONFIG.aiAnalysisEndpoint);
const CSV_REQUIRED_FIELDS = ["question", "answer", "level"];
const AUTH_EMAIL_KEY = "question_bank_auth_email";

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, "").toLowerCase();
}

function normalizeAnswer(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value == null) return [];
  const text = String(value).trim();
  if (!text) return [];
  if (/^(√|对|正确|true|t|1)$/i.test(text)) return ["√"];
  if (/^(×|错|错误|false|f|0)$/i.test(text)) return ["×"];
  if (/^[a-h](?:[\s,，、;；]+[a-h])*$/i.test(text)) {
    return [...new Set(text.toUpperCase().match(/[A-H]/g) || [])];
  }
  const tokens = text.toUpperCase().match(/[A-H]|√|×/g);
  return tokens ? [...new Set(tokens)] : [text];
}

function canonicalAnswers(value) {
  return normalizeAnswer(value).map((item) => String(item).trim()).filter(Boolean).sort();
}

function answersEqual(left, right) {
  const a = canonicalAnswers(left);
  const b = canonicalAnswers(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function normalizeLevel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (COMMON_LEVEL_KEYS.includes(text) || COMMON_LEVEL_KEYS.includes(String(value || "").trim())) return "common";
  const found = LEVELS.find((item) => item.value === text || item.label === value);
  return found ? found.value : "junior";
}

function inferQuestionTypeFromCsv(row) {
  const answer = normalizeAnswer(row.answer);
  if (answer.includes("√") || answer.includes("×")) return "judge";
  if (answer.length > 1) return "multiple";
  return "single";
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvText(text) {
  const lines = String(text || "").replace(/^\ufeff/, "").replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((item) => item.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((row, key, index) => {
      row[key] = values[index] || "";
      return row;
    }, {});
  });
}

function csvRowToQuestion(row) {
  const options = [
    ["A", row.option_a],
    ["B", row.option_b],
    ["C", row.option_c],
    ["D", row.option_d],
  ].filter(([, text]) => String(text || "").trim()).map(([key, text]) => ({ key, text: String(text).trim() }));
  const questionType = inferQuestionTypeFromCsv(row);
  return {
    level: normalizeLevel(row.level),
    category: String(row.category || "CSV导入").trim(),
    chapter: String(row.chapter || "").trim(),
    profession: String(row.profession || "输气工").trim(),
    scope: String(row.scope || "").trim() || (normalizeLevel(row.level) === "common" ? "common" : "level"),
    question_type: questionType,
    question: String(row.question || "").trim(),
    stem: String(row.question || "").trim(),
    option_a: String(row.option_a || "").trim(),
    option_b: String(row.option_b || "").trim(),
    option_c: String(row.option_c || "").trim(),
    option_d: String(row.option_d || "").trim(),
    options: questionType === "judge" ? [] : options,
    answer: normalizeAnswer(row.answer),
    analysis: String(row.analysis || "").trim(),
    explanation: String(row.analysis || "").trim(),
  };
}

function formatDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  if (minutes <= 0) return `${rest}秒`;
  return `${minutes}分${String(rest).padStart(2, "0")}秒`;
}

function makeFingerprint(question) {
  const payload = JSON.stringify({
    type: question.question_type,
    stem: normalizeText(question.stem),
    options: question.options || [],
    answer: normalizeAnswer(question.answer),
  });
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)).then((buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

function fileExt(name) {
  return String(name || "").split(".").pop().toLowerCase();
}

function parseOptions(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([A-Z])[\.\、\s]*(.*)$/i);
      if (match) return { key: match[1].toUpperCase(), text: match[2].trim() };
      return { key: "", text: line };
    })
    .filter((item) => item.text);
}

function cleanQuestionText(text) {
  return String(text || "").replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeWordMarkers(text) {
  return String(text || "")
    .replace(/[［﹝]/g, "[")
    .replace(/[］﹞]/g, "]")
    .replace(/Ｆ/g, "F")
    .replace(/Ｔ/g, "T")
    .replace(/Ｄ/g, "D");
}

function normalizeOptionKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[Ａ-Ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function splitTheoryBlocks(text) {
  const clean = normalizeWordMarkers(String(text || "").replace(/\r/g, ""));
  const lines = clean.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const start = line.match(/^\s*(?:\d+[、.．]\s*)?@?\[T\]([\s\S]*)$/);
    if (start) {
      if (current) blocks.push(current);
      current = [start[1]];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);

  return blocks.map((linesInBlock) => {
    const block = linesInBlock.join("\n");
    const answerMatches = [...block.matchAll(/\[D\]([\s\S]*?)\[D\/\]/g)];
    if (answerMatches.length) {
      const answerMatch = answerMatches[answerMatches.length - 1];
      return {
        body: block.slice(0, answerMatch.index).replace(/\[D\]/g, "").replace(/\[T\/\]/g, "").trim(),
        answer: answerMatch[1].trim(),
        explanation: block.slice(answerMatch.index + answerMatch[0].length).replace(/\[T\/\]/g, "").trim(),
      };
    }

    const markerMatches = [...block.matchAll(/\[D\]/g)];
    if (!markerMatches.length) return { body: block, answer: "", explanation: "" };
    const marker = markerMatches[markerMatches.length - 1];
    return {
      body: block.slice(0, marker.index).replace(/\[D\]/g, "").replace(/\[T\/\]/g, "").trim(),
      answer: block.slice(marker.index + marker[0].length).trim(),
      explanation: "",
    };
  });
}

function parseTheoryQuestions(text, level, category) {
  const blocks = splitTheoryBlocks(text);
  const parsed = [];
  const logs = [];

  blocks.forEach((block, index) => {
    if (!block.answer) {
      logs.push(`第 ${index + 1} 题缺少答案标记`);
      return;
    }
    const rawBody = normalizeWordMarkers(block.body.replace(/^\s*\d+[、.．]\s*/, "").replace(/^@?\[T\]/, ""));
    let bodyLines = rawBody.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let chapter = "";
    const metaMatch = bodyLines[0]?.match(/^([A-Z]{2}\d{3})\s+\d+\s+\d+\s+\d+\s*(.*)$/);
    if (metaMatch) {
      chapter = metaMatch[1];
      bodyLines = [metaMatch[2], ...bodyLines.slice(1)].filter(Boolean);
    }
    const body = cleanQuestionText(bodyLines.join("\n").replace(/\[D\]/g, ""));
    const answer = normalizeAnswer(block.answer);

    const optionMatches = [...body.matchAll(/(?<![A-Za-z])([A-HＡ-Ｈ])[\.\、．:：)]\s*/g)];
    const options = [];
    let stem = body;
    if (optionMatches.length) {
      stem = cleanQuestionText(body.slice(0, optionMatches[0].index));
      optionMatches.forEach((match, optionIndex) => {
        const start = match.index + match[0].length;
        const end = optionMatches[optionIndex + 1]?.index ?? body.length;
        options.push({ key: normalizeOptionKey(match[1]), text: cleanQuestionText(body.slice(start, end)) });
      });
    } else {
      const tailLines = bodyLines
        .slice(1)
        .map((line) => line.replace(/^\[D\]\s*/, "").trim())
        .filter(Boolean);
      const numberedOptions = tailLines
        .filter((line) => /^\d+\s*[、.)]\s*/.test(line))
        .map((line) => line.replace(/^\d+\s*[、.)]\s*/, "").trim())
        .filter(Boolean);
      const inferredOptions = numberedOptions.length >= 2
        ? numberedOptions
        : (tailLines.length >= 3 ? tailLines : []);
      if (inferredOptions.length >= 2 && !answer.includes("√") && !answer.includes("×")) {
        stem = cleanQuestionText(bodyLines[0] || body);
        inferredOptions.slice(0, 8).forEach((text, optionIndex) => {
          options.push({ key: String.fromCharCode(65 + optionIndex), text: cleanQuestionText(text) });
        });
      }
    }

    let questionType = "single";
    if (answer.includes("√") || answer.includes("×")) {
      questionType = "judge";
    } else if (answer.length > 1) {
      questionType = "multiple";
    } else if (!options.length && answer.length && !/^[A-H]$/i.test(answer[0])) {
      questionType = "practical";
    }

    if (!stem) {
      logs.push(`第 ${index + 1} 题题干为空`);
      return;
    }

    parsed.push({
      level,
      category,
      question_type: questionType,
      stem,
      options,
      answer,
      chapter,
      explanation: block.explanation || "",
    });
  });

  return { questions: parsed, logs };
}

function parsePracticalQuestions(text, level, category) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const header = line.match(/^\s*(\d+)\s+([A-Z]{2}\d{3})\s+(.+)$/);
    if (header) {
      if (current) blocks.push(current);
      current = { title: header[3].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) blocks.push(current);

  const parsed = [];
  const logs = [];

  blocks.forEach((block, index) => {
    const stem = block.title.trim();
    if (!stem) {
      logs.push(`实操题块 ${index + 1} 标题为空`);
      return;
    }
    parsed.push({
      level,
      category,
      question_type: "practical",
      stem,
      options: [],
      answer: [],
      explanation: block.body.join("\n").trim(),
    });
  });

  return { questions: parsed, logs };
}

function inferParseMode(file) {
  const ext = fileExt(file.name);
  if (ext === "txt") return "txt";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc";
  return "unknown";
}

function isImportableQuestionFile(file) {
  return IMPORT_FILE_EXTENSIONS.has(fileExt(file.name));
}

function displayImportFileName(file) {
  return file.webkitRelativePath || file.name;
}

function inferFolderName(files) {
  const firstPath = files.find((file) => file.webkitRelativePath)?.webkitRelativePath || "";
  return firstPath.split(/[\\/]/).filter(Boolean)[0] || "";
}

function inferLevelFromPath(path) {
  const text = normalizeText(path);
  if (text.includes("通用") || text.includes("基础知识")) return "common";
  if (text.includes("高级技师")) return "senior_technician";
  if (text.includes("技师")) return "technician";
  if (text.includes("高级")) return "senior";
  if (text.includes("中级")) return "middle";
  if (text.includes("初级")) return "junior";
  return "";
}

function inferCategoryFromPath(path, fallback) {
  const text = String(path || "");
  if (/实操|操作|技能/i.test(text)) return "实操题库";
  if (/理论|单选|多选|判断/i.test(text)) return "理论题库";
  return fallback;
}

function inferQuestionTypeCategory(category, questionType) {
  if (questionType === "practical") return "实操题库";
  return category || "理论题库";
}

createApp({
  template: document.getElementById("app-template").innerHTML,
  setup() {
    const supabase = supabaseClient;
    const ready = ref(Boolean(hasSupabaseConfig && supabase));
    const tab = ref(window.INITIAL_TAB || "home");
    const userId = ref("");
    const profileName = ref("");
    const authEmail = ref("");
    const profileForm = ref({
      mode: "sign_in",
      name: "",
      email: localStorage.getItem(AUTH_EMAIL_KEY) || "",
      password: "",
    });
    const message = ref("");
    const error = ref("");
    const uploadStatus = ref({ state: "idle", title: "", detail: "" });
    const uploadForm = ref({
      file: null,
      files: [],
      level: "junior",
      category: "输气工基础技术",
      autoDetectMeta: true,
      folderName: "",
      skippedCount: 0,
      pickMode: "files",
    });
    const sourceFiles = ref([]);
    const questions = ref([]);
    const answerRecords = ref([]);
    const examRecords = ref([]);
    const chapters = ref([]);
    const favoriteSet = ref(new Set());
    const stats = ref({ totalQuestions: 0, doneQuestions: 0, correctRate: 0, favorites: 0 });
    const practiceFilter = ref({ level: "", type: "", source_file_id: "", search: "", favoritesOnly: false });
    const wrongFilter = ref({ level: "", type: "", search: "" });
    const questionIndex = ref(0);
    const selectedAnswers = ref([]);
    const practicalAnswer = ref("");
    const practiceResult = ref(null);
    const practiceSubmitting = ref(false);
    const examForm = ref({ level: "junior", mode: "answer" });
    const examQuestions = ref([]);
    const examAnswers = ref({});
    const examResult = ref(null);
    const examRevealSet = ref(new Set());
    const examSecondsLeft = ref(0);
    const examTimer = ref(null);
    const examInProgress = ref(false);
    const examStartedAt = ref(null);
    const aiAnalysisByQuestionId = ref({});
    const editor = ref({
      level: "junior",
      category: "输气工基础技术",
      chapter: "",
      question_type: "single",
      stem: "",
      optionsText: "A. \nB. \nC. \nD. ",
      answerText: "",
      explanation: "",
    });
    const editingId = ref(null);
    const manageSearch = ref("");
    const csvImport = ref({ file: null, rows: [], errors: [], validRows: [], imported: 0 });
    const chapterEditor = ref({ id: null, level: "junior", name: "", sort_order: 0 });

    const visibleQuestions = computed(() => {
      let list = [...questions.value];
      if (practiceFilter.value.level) {
        const level = LEVELS.find((item) => item.value === practiceFilter.value.level);
        list = level ? list.filter((item) => levelMatches(item, level)) : list.filter((item) => item.level === practiceFilter.value.level);
      }
      if (practiceFilter.value.type) list = list.filter((item) => item.question_type === practiceFilter.value.type);
      if (practiceFilter.value.source_file_id) list = list.filter((item) => String(item.source_file_id) === String(practiceFilter.value.source_file_id));
      if (practiceFilter.value.search) {
        const keyword = practiceFilter.value.search.toLowerCase();
        list = list.filter((item) => `${item.stem} ${item.explanation || ""}`.toLowerCase().includes(keyword));
      }
      if (practiceFilter.value.favoritesOnly) {
        list = list.filter((item) => favoriteSet.value.has(item.id));
      }
      return list;
    });

    const managedQuestions = computed(() => {
      const keyword = manageSearch.value.toLowerCase();
      if (!keyword) return questions.value;
      return questions.value.filter((item) => `${item.stem} ${item.explanation || ""} ${item.chapter || ""}`.toLowerCase().includes(keyword));
    });

    const levelDashboard = ref(LEVELS.map((level) => ({
      ...level,
      total: null,
      done: 0,
      correctRate: 0,
      progress: 0,
    })));

    const learningStats = computed(() => {
      const today = new Date().toDateString();
      const todayDone = answerRecords.value.filter((item) => new Date(item.created_at).toDateString() === today).length;
      const autoRecords = answerRecords.value.filter((item) => item.is_correct === true || item.is_correct === false);
      const correct = autoRecords.filter((item) => item.is_correct === true).length;
      const learnedDays = new Set(answerRecords.value.map((item) => new Date(item.created_at).toDateString()));
      let streakDays = 0;
      const cursor = new Date();
      while (learnedDays.has(cursor.toDateString())) {
        streakDays += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return {
        todayDone,
        streakDays,
        correctRate: autoRecords.length ? Math.round((correct / autoRecords.length) * 100) : 0,
      };
    });

    const todayTask = computed(() => {
      const target = 20;
      const done = answerRecords.value.filter((item) => new Date(item.created_at).toDateString() === new Date().toDateString()).length;
      return { target, done, remaining: Math.max(0, target - done) };
    });

    const recentExams = computed(() => (examRecords.value || []).slice(0, 3).map((item) => ({
      ...item,
      dateText: item.created_at ? new Date(item.created_at).toLocaleDateString("zh-CN") : "",
      timeText: formatDuration(item.duration || 0),
    })));

    const chapterMastery = computed(() => {
      const groups = new Map();
      questions.value.forEach((question) => {
        const name = question.chapter || question.category || "未分章节";
        const key = `${question.level}:${name}`;
        if (!groups.has(key)) groups.set(key, { key, level: question.level, name, total: 0, questionIds: new Set() });
        const group = groups.get(key);
        group.total += 1;
        group.questionIds.add(question.id);
      });
      return [...groups.values()].map((group) => {
        const records = answerRecords.value.filter((item) => group.questionIds.has(item.question_id));
        const answeredIds = new Set(records.map((item) => item.question_id));
        const autoRecords = records.filter((item) => item.is_correct === true || item.is_correct === false);
        const correct = autoRecords.filter((item) => item.is_correct === true).length;
        return {
          ...group,
          done: answeredIds.size,
          progress: group.total ? Math.round((answeredIds.size / group.total) * 100) : 0,
          correctRate: autoRecords.length ? Math.round((correct / autoRecords.length) * 100) : 0,
        };
      }).sort((a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name));
    });

    const currentQuestion = computed(() => visibleQuestions.value[questionIndex.value] || null);
    const currentStoredExplanation = computed(() => currentQuestion.value?.explanation || "");
    const answeredCount = computed(() => Object.keys(examAnswers.value).length);
    const selectedUploadSummary = computed(() => {
      const count = uploadForm.value.files ? uploadForm.value.files.length : 0;
      const skipped = uploadForm.value.skippedCount || 0;
      const folder = uploadForm.value.folderName;
      if (!count && skipped) return `未找到可导入题库文件，已忽略 ${skipped} 个其他文件`;
      if (!count) return "还未选择题库文件或文件夹";
      const scope = folder ? `文件夹「${folder}」` : "当前选择";
      const skippedText = skipped ? `，已忽略 ${skipped} 个非题库文件` : "";
      return `${scope}：已准备 ${count} 个 .doc / .docx / .txt 文件${skippedText}`;
    });
    const uploadButtonText = computed(() => {
      if (uploadStatus.value.state !== "running") return "写入后台题库";
      return uploadStatus.value.title || "正在写入后台题库";
    });
    const wrongQuestionIds = computed(
      () => new Set(answerRecords.value.filter((item) => item.is_correct === false).map((item) => item.question_id))
    );
    const wrongQuestions = computed(() => {
      let list = questions.value.filter((item) => wrongQuestionIds.value.has(item.id));
      if (wrongFilter.value.level) {
        const level = LEVELS.find((item) => item.value === wrongFilter.value.level);
        list = level ? list.filter((item) => levelMatches(item, level)) : list.filter((item) => item.level === wrongFilter.value.level);
      }
      if (wrongFilter.value.type) list = list.filter((item) => item.question_type === wrongFilter.value.type);
      if (wrongFilter.value.search) {
        const keyword = wrongFilter.value.search.toLowerCase();
        list = list.filter((item) => `${item.stem} ${item.explanation || ""}`.toLowerCase().includes(keyword));
      }
      return list;
    });
    const examCountdown = computed(() => formatCountdown(examSecondsLeft.value));

    function setMessage(text) {
      message.value = text;
      error.value = "";
    }

    function setError(text) {
      error.value = text;
      message.value = "";
    }

    function setUploadStatus(state, title, detail = "") {
      uploadStatus.value = { state, title, detail };
    }

    function sourceName(id) {
      const found = sourceFiles.value.find((item) => String(item.id) === String(id));
      return found ? found.original_name : "手动题目";
    }

    function labelOfLevel(value) {
      return LEVELS.find((item) => item.value === value)?.label || value || "全部";
    }

    function levelMatches(question, level) {
      return question.scope === "common"
        || COMMON_LEVEL_KEYS.includes(question.level)
        || question.level === level.value
        || question.level === level.label;
    }

    function levelCountKeys(level) {
      return [...new Set([level.value, level.label, ...COMMON_LEVEL_KEYS].filter(Boolean))];
    }

    function labelOfType(value) {
      return QUESTION_TYPES.find((item) => item.value === value)?.label || value || "未知";
    }

    function buildExamPlan(available) {
      const planned = {
        single: Math.min(available.single || 0, EXAM_RULE.single),
        multiple: Math.min(available.multiple || 0, EXAM_RULE.multiple),
        judge: Math.min(available.judge || 0, EXAM_RULE.judge),
      };
      const total = planned.single + planned.multiple + planned.judge;
      const full = planned.single === EXAM_RULE.single
        && planned.multiple === EXAM_RULE.multiple
        && planned.judge === EXAM_RULE.judge;
      return { ...planned, total, full };
    }

    function formatCountdown(totalSeconds) {
      const safe = Math.max(0, Number(totalSeconds) || 0);
      const hours = Math.floor(safe / 3600);
      const minutes = Math.floor((safe % 3600) / 60);
      const seconds = safe % 60;
      return [hours, minutes, seconds].map((item) => String(item).padStart(2, "0")).join(":");
    }

    function clearExamTimer() {
      if (examTimer.value) {
        window.clearInterval(examTimer.value);
        examTimer.value = null;
      }
    }

    function resetExamState() {
      clearExamTimer();
      examSecondsLeft.value = 0;
      examRevealSet.value = new Set();
      examInProgress.value = false;
      examStartedAt.value = null;
    }

    function toggleExamReveal(questionId) {
      const next = new Set(examRevealSet.value);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      examRevealSet.value = next;
    }

    function resetWrongFilters() {
      wrongFilter.value = { level: "", type: "", search: "" };
    }

    async function ensureClient() {
      if (!supabase) {
        ready.value = false;
        throw new Error("请先填写 app-config.js");
      }
      ready.value = true;
      return supabase;
    }

    async function syncAuthState() {
      const user = await getCurrentAuthUser();
      userId.value = user?.id || "";
      authEmail.value = user?.email || "";
      profileName.value = user?.user_metadata?.display_name
        || user?.user_metadata?.full_name
        || user?.email
        || "";
      if (authEmail.value) {
        localStorage.setItem(AUTH_EMAIL_KEY, authEmail.value);
        profileForm.value.email = authEmail.value;
      }
      return user;
    }

    async function requireSignedIn() {
      if (!userId.value) await syncAuthState();
      if (!userId.value) {
        tab.value = "profile";
        throw new Error("请先用邮箱和密码登录，再保存学习记录或管理题库。");
      }
      return userId.value;
    }

    async function ensureProfile(client) {
      if (!userId.value) return;
      const result = await client.from("profiles").upsert({
        id: userId.value,
        username: profileName.value || authEmail.value || `用户${userId.value.slice(0, 8)}`,
      }, { onConflict: "id" });
      if (result.error) throw result.error;
    }

    function fillCurrentProfile() {
      profileForm.value = {
        mode: "sign_in",
        name: profileName.value || "",
        email: authEmail.value || profileForm.value.email || "",
        password: "",
      };
    }

    async function loginProfile() {
      try {
        const client = await ensureClient();
        const email = profileForm.value.email.trim();
        const password = profileForm.value.password.trim();
        const name = profileForm.value.name.trim();
        if (!email) throw new Error("请输入邮箱");
        if (password.length < 6) throw new Error("密码至少 6 位");
        const result = profileForm.value.mode === "sign_up"
          ? await signUpWithPassword(email, password, name || email)
          : await signInWithPassword(email, password);
        if (result.error) throw result.error;
        profileForm.value.password = "";
        localStorage.setItem(AUTH_EMAIL_KEY, email);
        await syncAuthState();
        if (userId.value) {
          await ensureProfile(client);
          setMessage(profileForm.value.mode === "sign_up" ? "注册并登录成功。" : `已登录：${profileName.value || email}`);
          tab.value = "practice";
        } else {
          setMessage("注册成功，请按 Supabase 邮件确认设置完成后再登录。");
          tab.value = "profile";
        }
        await loadAll();
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    async function logoutProfile() {
      try {
        const result = await signOutUser();
        if (result.error) throw result.error;
        profileName.value = "";
        authEmail.value = "";
        userId.value = "";
        profileForm.value = {
          mode: "sign_in",
          name: "",
          email: localStorage.getItem(AUTH_EMAIL_KEY) || "",
          password: "",
        };
        await loadAll();
        setMessage("已退出登录。题库仍可浏览，收藏、答题记录和考试记录需登录后保存。");
        tab.value = "profile";
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    function updateDashboardProgress() {
      levelDashboard.value = levelDashboard.value.map((level) => {
        const levelQuestions = questions.value.filter((item) => levelMatches(item, level));
        const ids = new Set(levelQuestions.map((item) => item.id));
        const levelRecords = answerRecords.value.filter((item) => ids.has(item.question_id));
        const answeredIds = new Set(levelRecords.map((item) => item.question_id));
        const autoRecords = levelRecords.filter((item) => item.is_correct === true || item.is_correct === false);
        const correct = autoRecords.filter((item) => item.is_correct === true).length;
        const total = level.total ?? levelQuestions.length;
        return {
          ...level,
          total,
          done: answeredIds.size,
          correctRate: autoRecords.length ? Math.round((correct / autoRecords.length) * 100) : 0,
          progress: total ? Math.round((answeredIds.size / total) * 100) : 0,
        };
      });
    }

    async function loadDashboard() {
      try {
        const client = await ensureClient();
        console.log("Supabase连接", supabaseClient);
        const counts = await Promise.all(
          LEVELS.map((level) => getQuestionCount(levelCountKeys(level)))
        );
        const data = LEVELS.map((level, index) => ({
          ...level,
          total: counts[index],
          done: 0,
          correctRate: 0,
          progress: 0,
        }));
        console.log("题库数量", data);
        levelDashboard.value = data;
        updateDashboardProgress();
        return data;
      } catch (err) {
        const detail = err.message || String(err);
        console.error("题库数量读取失败", err);
        setError(`题库数量读取失败：${detail}`);
        throw err;
      }
    }

    async function loadAll(forceFresh = false) {
      const client = await ensureClient();
      if (!userId.value) userId.value = await resolveUserId();
      await syncAuthState();
      const [
        sourceResult,
        questionList,
        chapterResult,
      ] = await Promise.all([
        client.from("source_files").select("*").order("created_at", { ascending: false }),
        (forceFresh ? getQuestions() : getQuestionsCached()),
        client.from("chapters").select("*").order("level", { ascending: true }).order("sort_order", { ascending: true }),
      ]);

      if (sourceResult.error) throw sourceResult.error;
      if (chapterResult.error) throw chapterResult.error;

      let favoriteResult = { data: [] };
      let recordResult = { data: [] };
      let examRecordResult = { data: [] };
      if (userId.value) {
        await ensureProfile(client);
        [favoriteResult, recordResult, examRecordResult] = await Promise.all([
          client.from("favorites").select("question_id").eq("user_id", userId.value),
          client.from("answer_records").select("*").eq("user_id", userId.value),
          client.from("exam_records").select("*").eq("user_id", userId.value).order("created_at", { ascending: false }),
        ]);
        if (favoriteResult.error) throw favoriteResult.error;
        if (recordResult.error) throw recordResult.error;
        if (examRecordResult.error) throw examRecordResult.error;
      }

      sourceFiles.value = sourceResult.data || [];
      questions.value = questionList || [];
      favoriteSet.value = new Set((favoriteResult.data || []).map((item) => item.question_id));
      answerRecords.value = (recordResult.data || []).map((item) => ({
        ...item,
        is_correct: item.is_correct ?? item.correct,
        submitted_answer: item.submitted_answer || item.answer || [],
        answer: item.answer || item.submitted_answer || [],
      }));
      chapters.value = chapterResult.data || [];
      examRecords.value = examRecordResult.data || [];

      const records = answerRecords.value;
      const doneQuestions = new Set(records.map((item) => item.question_id)).size;
      const correctCount = records.filter((item) => item.is_correct === true).length;
      const autoCount = records.filter((item) => item.is_correct === true || item.is_correct === false).length;
      stats.value = {
        totalQuestions: questions.value.length,
        doneQuestions,
        correctRate: autoCount ? Math.round((correctCount / autoCount) * 100) : 0,
        favorites: favoriteSet.value.size,
      };
      updateDashboardProgress();
    }

    function setPickedUploadFiles(rawFiles, pickMode) {
      const allFiles = Array.from(rawFiles || []);
      const files = allFiles.filter(isImportableQuestionFile);
      uploadForm.value.files = files;
      uploadForm.value.file = files[0] || null;
      uploadForm.value.skippedCount = allFiles.length - files.length;
      uploadForm.value.pickMode = pickMode;
      uploadForm.value.folderName = pickMode === "folder" ? inferFolderName(allFiles) : "";
      const inferredLevel = files.map((file) => inferLevelFromPath(displayImportFileName(file))).find(Boolean);
      if (uploadForm.value.autoDetectMeta && inferredLevel) {
        uploadForm.value.level = inferredLevel;
      }
      if (files.length) {
        const scope = uploadForm.value.folderName ? `文件夹「${uploadForm.value.folderName}」` : "当前选择";
        setUploadStatus("picked", "已选择题库文件", `${scope}已准备 ${files.length} 个可导入文件。点击“写入后台题库”开始导入。`);
        setMessage(`${scope}已准备 ${files.length} 个可导入文件。`);
      } else if (allFiles.length) {
        setUploadStatus("picked", "没有可导入文件", `已忽略 ${allFiles.length} 个非 .doc / .docx / .txt 文件。`);
        setError("没有找到可导入的题库文件。");
      } else {
        setUploadStatus("idle", "", "");
      }
    }

    async function onPickUploadFile(event) {
      setPickedUploadFiles(event.target.files, "files");
    }

    async function onPickUploadFolder(event) {
      setPickedUploadFiles(event.target.files, "folder");
    }

    function inferImportMeta(file) {
      const originalName = displayImportFileName(file);
      const detectedLevel = uploadForm.value.autoDetectMeta ? inferLevelFromPath(originalName) : "";
      const level = detectedLevel || uploadForm.value.level;
      const category = uploadForm.value.autoDetectMeta
        ? inferCategoryFromPath(originalName, uploadForm.value.category)
        : uploadForm.value.category;
      const scope = level === "common" ? "common" : "level";
      return { originalName, level, category, profession: "输气工", scope };
    }

    async function parseQuestionFile(file, meta) {
      const originalName = displayImportFileName(file);
      let parseResult = { questions: [], logs: [] };
      const ext = inferParseMode(file);
      if (ext === "doc") {
        parseResult.logs.push("检测到 .doc 文件，静态前端无法解析旧 Word 二进制格式。建议转成 .docx 后再导入。");
      } else {
        let text = "";
        if (ext === "txt") {
          text = await file.text();
        } else if (ext === "docx") {
          const buf = await file.arrayBuffer();
          text = window.mammoth ? (await window.mammoth.extractRawText({ arrayBuffer: buf })).value : "";
          if (!text) parseResult.logs.push("mammoth 未返回文本，文件未识别出题目。");
        } else {
          parseResult.logs.push("未知文件类型，未解析。");
        }

        const theory = parseTheoryQuestions(text, meta.level, inferQuestionTypeCategory(meta.category, "single"));
        const practical = parsePracticalQuestions(text, meta.level, "实操题库");
        parseResult.questions = [...theory.questions, ...practical.questions];
        parseResult.logs.push(...theory.logs, ...practical.logs);
      }

      if (!parseResult.questions.length) {
        parseResult.logs.push("没有识别出可写入题库的题目。");
      }

      return { originalName, parseResult };
    }

    function isSchemaColumnError(error) {
      const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
      return text.includes("column") || text.includes("schema cache") || text.includes("could not find");
    }

    function legacyQuestionPayload(row) {
      const {
        question,
        option_a,
        option_b,
      option_c,
      option_d,
      analysis,
      profession,
      scope,
      ...legacy
    } = row;
      return legacy;
    }

    function legacyAnswerRecordPayload(row) {
      const { answer, correct, ...legacy } = row;
      return legacy;
    }

    function legacySourceFilePayload(row) {
      const { profession, scope, ...legacy } = row;
      return legacy;
    }

    async function insertAnswerRecord(client, payload) {
      const result = await client.from("answer_records").insert(payload);
      if (!result.error) return result;
      if (!isSchemaColumnError(result.error)) throw result.error;
      const retry = await client.from("answer_records").insert(legacyAnswerRecordPayload(payload));
      if (retry.error) throw retry.error;
      return retry;
    }

    async function insertQuestionBatches(client, questionsToInsert, onProgress) {
      let inserted = 0;
      let duplicateOrSkipped = 0;

      for (let start = 0; start < questionsToInsert.length; start += INSERT_BATCH_SIZE) {
        const batch = questionsToInsert.slice(start, start + INSERT_BATCH_SIZE);
        onProgress?.(start, questionsToInsert.length);
        const result = await client
          .from("questions")
          .upsert(batch, { onConflict: "fingerprint", ignoreDuplicates: true })
          .select("id");
        let finalResult = result;
        if (result.error && isSchemaColumnError(result.error)) {
          finalResult = await client
            .from("questions")
            .upsert(batch.map(legacyQuestionPayload), { onConflict: "fingerprint", ignoreDuplicates: true })
            .select("id");
        }
        if (finalResult.error) throw finalResult.error;
        const insertedCount = (finalResult.data || []).length;
        inserted += insertedCount;
        duplicateOrSkipped += batch.length - insertedCount;
      }

      onProgress?.(questionsToInsert.length, questionsToInsert.length);
      return { inserted, duplicateOrSkipped };
    }

    async function importQuestionFile(client, file) {
      const meta = inferImportMeta(file);
      const { originalName, parseResult } = await parseQuestionFile(file, meta);
      const sourcePayload = {
        original_name: originalName,
        level: meta.level,
        category: meta.category,
        profession: meta.profession,
        scope: meta.scope,
        status: "importing",
        log: "后台直灌：不上传原文件，只批量写入 Supabase 题库表。",
      };
      let sourceInsert = await client.from("source_files").insert(sourcePayload).select().single();
      if (sourceInsert.error && isSchemaColumnError(sourceInsert.error)) {
        sourceInsert = await client.from("source_files").insert(legacySourceFilePayload(sourcePayload)).select().single();
      }
      if (sourceInsert.error) throw sourceInsert.error;

      let imported = 0;
      let duplicates = 0;
      let unrecognized = parseResult.logs.length;
      const rows = await Promise.all(parseResult.questions.map(async (item) => {
        const fingerprint = await makeFingerprint(item);
        const options = item.options || [];
        const optionA = options.find((opt) => opt.key === "A")?.text || "";
        const optionB = options.find((opt) => opt.key === "B")?.text || "";
        const optionC = options.find((opt) => opt.key === "C")?.text || "";
        const optionD = options.find((opt) => opt.key === "D")?.text || "";
        const answerText = normalizeAnswer(item.answer).join(" ");
        const analysis = item.explanation || "";
        return {
          level: item.level,
          category: item.category,
          chapter: item.chapter || item.category || "",
          profession: meta.profession,
          scope: meta.scope,
          question_type: item.question_type,
          question: item.stem,
          option_a: optionA,
          option_b: optionB,
          option_c: optionC,
          option_d: optionD,
          answer: answerText,
          analysis,
          stem: item.stem,
          options: item.options,
          explanation: analysis,
          source_file_id: sourceInsert.data.id,
          fingerprint,
        };
      }));

      if (rows.length) {
        const batchResult = await insertQuestionBatches(client, rows);
        imported = batchResult.inserted;
        duplicates = batchResult.duplicateOrSkipped;
      }

      const updateResult = await client.from("source_files").update({
        imported_count: imported,
        duplicate_count: duplicates,
        unrecognized_count: unrecognized,
        status: parseResult.questions.length ? "imported" : "uploaded",
        log: parseResult.logs.join("\n") || "后台直灌完成。",
      }).eq("id", sourceInsert.data.id);
      if (updateResult.error) throw updateResult.error;

      return { name: originalName, imported, duplicates, unrecognized };
    }

    async function uploadAndParse() {
      try {
        const client = await ensureClient();
        await requireSignedIn();
        const files = uploadForm.value.files && uploadForm.value.files.length
          ? uploadForm.value.files
          : (uploadForm.value.file ? [uploadForm.value.file] : []);
        if (!files.length) throw new Error("请先选择题库文件或题库文件夹");

        let totalImported = 0;
        let totalDuplicates = 0;
        let totalUnrecognized = 0;
        const names = [];
        const scope = uploadForm.value.folderName ? `文件夹「${uploadForm.value.folderName}」` : "当前选择";
        setMessage("");
        setUploadStatus("running", `正在写入 0/${files.length}`, `${scope}正在连接 Supabase 后台题库。`);
        for (const [index, file] of files.entries()) {
          setUploadStatus("running", `正在写入 ${index + 1}/${files.length}`, displayImportFileName(file));
          const result = await importQuestionFile(client, file);
          names.push(result.name);
          totalImported += result.imported;
          totalDuplicates += result.duplicates;
          totalUnrecognized += result.unrecognized;
        }

        setMessage(`已直灌后台题库：${scope}共 ${names.length} 个文件，导入 ${totalImported} 题，重复 ${totalDuplicates} 题，未识别 ${totalUnrecognized} 处。`);
        setUploadStatus("done", "后台题库写入完成", `导入 ${totalImported} 题，重复 ${totalDuplicates} 题，未识别 ${totalUnrecognized} 处。`);
        uploadForm.value.file = null;
        uploadForm.value.files = [];
        uploadForm.value.folderName = "";
        uploadForm.value.skippedCount = 0;
        await loadAll(true);
      } catch (err) {
        setUploadStatus("failed", "保存失败", err.message || String(err));
        setError(err.message || String(err));
      }
    }

    async function requestAiAnalysis(question) {
      try {
        if (!question) throw new Error("没有可解析的题目");
        const endpoint = CONFIG.aiAnalysisEndpoint || "";
        if (!endpoint) {
          throw new Error("AI解析接口未配置。请在 app-config.js 填写 aiAnalysisEndpoint，接口接收 POST JSON：{ question }。");
        }
        aiAnalysisByQuestionId.value = {
          ...aiAnalysisByQuestionId.value,
          [question.id]: { text: "AI解析生成中..." },
        };
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });
        if (!response.ok) throw new Error(`AI解析接口返回 ${response.status}`);
        const data = await response.json();
        aiAnalysisByQuestionId.value = {
          ...aiAnalysisByQuestionId.value,
          [question.id]: { text: data.analysis || data.explanation || data.text || "AI接口未返回解析文本。" },
        };
      } catch (err) {
        aiAnalysisByQuestionId.value = {
          ...aiAnalysisByQuestionId.value,
          [question?.id || "error"]: { text: err.message || String(err) },
        };
        setError(err.message || String(err));
      }
    }

    function resetPractice() {
      questionIndex.value = 0;
      selectedAnswers.value = [];
      practicalAnswer.value = "";
      practiceResult.value = null;
    }

    function shuffleQuestions() {
      practiceFilter.value.order = practiceFilter.value.order === "random" ? "newest" : "random";
      shuffleInPlace(visibleQuestions.value);
      resetPractice();
    }

    function shuffleInPlace(list) {
      for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    }

    function loadIntoPractice(item) {
      const index = visibleQuestions.value.findIndex((question) => question.id === item.id);
      if (index >= 0) questionIndex.value = index;
      selectedAnswers.value = [];
      practicalAnswer.value = "";
      practiceResult.value = null;
      tab.value = "practice";
    }

    function enterLevel(level) {
      practiceFilter.value = { ...practiceFilter.value, level, type: "", source_file_id: "", search: "", favoritesOnly: false };
      resetPractice();
      tab.value = "practice";
    }

    function jumpToQuestion(index) {
      questionIndex.value = index;
      selectedAnswers.value = [];
      practicalAnswer.value = "";
      practiceResult.value = null;
    }

    function questionStatus(item) {
      return {
        active: currentQuestion.value?.id === item.id,
        done: answerRecords.value.some((record) => record.question_id === item.id),
        favorite: favoriteSet.value.has(item.id),
      };
    }

    function optionClass(opt) {
      const selected = selectedAnswers.value.includes(opt.key);
      const correct = practiceResult.value?.correctAnswers || [];
      return {
        active: selected && !practiceResult.value,
        correct: practiceResult.value && correct.includes(opt.key),
        wrong: practiceResult.value && selected && !correct.includes(opt.key),
      };
    }

    async function toggleAnswer(value, type) {
      if (type === "multiple") {
        practiceResult.value = null;
        selectedAnswers.value = selectedAnswers.value.includes(value)
          ? selectedAnswers.value.filter((item) => item !== value)
          : [...selectedAnswers.value, value];
      } else {
        selectedAnswers.value = [value];
        await submitPractice([value]);
      }
    }

    function nextQuestion() {
      if (questionIndex.value < visibleQuestions.value.length - 1) questionIndex.value += 1;
      selectedAnswers.value = [];
      practicalAnswer.value = "";
      practiceResult.value = null;
    }

    function previousQuestion() {
      if (questionIndex.value > 0) questionIndex.value -= 1;
      selectedAnswers.value = [];
      practicalAnswer.value = "";
      practiceResult.value = null;
    }

    async function toggleFavorite(item) {
      try {
        const client = await ensureClient();
        await requireSignedIn();
        if (favoriteSet.value.has(item.id)) {
          const result = await client.from("favorites").delete().eq("question_id", item.id).eq("user_id", userId.value);
          if (result.error) throw result.error;
        } else {
          const result = await client.from("favorites").insert({ question_id: item.id, user_id: userId.value });
          if (result.error) throw result.error;
        }
        await loadAll();
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    async function submitPractice(explicitAnswers = null) {
      if (practiceSubmitting.value) return;
      try {
        practiceSubmitting.value = true;
        const client = await ensureClient();
        await requireSignedIn();
        const question = currentQuestion.value;
        if (!question) throw new Error("没有当前题目");

        let result = {
          label: "已保存",
          is_correct: null,
          correctAnswer: normalizeAnswer(question.answer).join(" "),
          correctAnswers: normalizeAnswer(question.answer),
          explanation: question.explanation || "",
        };

        if (question.question_type === "practical") {
          const inserted = await insertAnswerRecord(client, {
            question_id: question.id,
            user_id: userId.value,
            answer: normalizeAnswer(practicalAnswer.value).join(" "),
            correct: null,
            submitted_answer: normalizeAnswer(practicalAnswer.value),
            is_correct: null,
          });
          if (inserted.error) throw inserted.error;
          result.label = "实操题已提交，当前版本只保存答案，暂不自动判分。";
        } else {
          const submitted = normalizeAnswer(explicitAnswers || selectedAnswers.value);
          if (!submitted.length) throw new Error("请先选择答案");
          const correct = normalizeAnswer(question.answer);
          const isCorrect = answersEqual(submitted, correct);
          const inserted = await insertAnswerRecord(client, {
            question_id: question.id,
            user_id: userId.value,
            answer: submitted.join(" "),
            correct: isCorrect,
            submitted_answer: submitted,
            is_correct: isCorrect,
          });
          if (inserted.error) throw inserted.error;
          result = {
            label: isCorrect ? "答对了" : "答错了",
            is_correct: isCorrect,
            correctAnswer: correct.join(" "),
            correctAnswers: correct,
            explanation: question.explanation || "",
          };
        }

        practiceResult.value = result;
        await loadAll();
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        practiceSubmitting.value = false;
      }
    }

    function editQuestion(item) {
      editingId.value = item.id;
      editor.value = {
        level: item.level,
        category: item.category,
        chapter: item.chapter || "",
        question_type: item.question_type,
        stem: item.stem,
        optionsText: (item.options || []).map((opt) => `${opt.key}. ${opt.text}`).join("\n"),
        answerText: normalizeAnswer(item.answer).join(" "),
        explanation: item.explanation || "",
      };
      tab.value = "admin";
    }

    function clearEditor() {
      editingId.value = null;
      editor.value = {
        level: "junior",
        category: "输气工基础技术",
        chapter: "",
        question_type: "single",
        stem: "",
        optionsText: "A. \nB. \nC. \nD. ",
        answerText: "",
        explanation: "",
      };
    }

    async function saveQuestion() {
      try {
        const client = await ensureClient();
        await requireSignedIn();
        const payload = {
          level: editor.value.level,
          category: editor.value.category,
          chapter: editor.value.chapter || "",
          profession: "输气工",
          scope: "level",
          question_type: editor.value.question_type,
          question: editor.value.stem,
          stem: editor.value.stem,
          options: editor.value.question_type === "practical" ? [] : parseOptions(editor.value.optionsText),
          option_a: "",
          option_b: "",
          option_c: "",
          option_d: "",
          answer: normalizeAnswer(editor.value.answerText).join(" "),
          analysis: editor.value.explanation,
          explanation: editor.value.explanation,
        };
        const parsedOptions = editor.value.question_type === "practical" ? [] : parseOptions(editor.value.optionsText);
        payload.option_a = parsedOptions.find((opt) => opt.key === "A")?.text || "";
        payload.option_b = parsedOptions.find((opt) => opt.key === "B")?.text || "";
        payload.option_c = parsedOptions.find((opt) => opt.key === "C")?.text || "";
        payload.option_d = parsedOptions.find((opt) => opt.key === "D")?.text || "";
        if (!payload.stem.trim()) throw new Error("题干不能为空");

        const fingerprint = await makeFingerprint(payload);
        const dupQuery = client.from("questions").select("id").eq("fingerprint", fingerprint).limit(1);
        const dupResult = editingId.value ? await dupQuery.neq("id", editingId.value) : await dupQuery;
        if (dupResult.error) throw dupResult.error;
        if ((dupResult.data || []).length) throw new Error("重复题目已存在");

        let result;
        if (editingId.value) {
          const updatePayload = {
            ...payload,
            fingerprint,
            updated_at: new Date().toISOString(),
          };
          result = await client.from("questions").update(updatePayload).eq("id", editingId.value);
          if (result.error && isSchemaColumnError(result.error)) {
            result = await client.from("questions").update(legacyQuestionPayload(updatePayload)).eq("id", editingId.value);
          }
        } else {
          const insertPayload = { ...payload, fingerprint };
          result = await client.from("questions").insert(insertPayload);
          if (result.error && isSchemaColumnError(result.error)) {
            result = await client.from("questions").insert(legacyQuestionPayload(insertPayload));
          }
        }
        if (result.error) throw result.error;
        setMessage(editingId.value ? "题目已更新" : "题目已保存");
        clearEditor();
        await loadAll(true);
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    async function deleteQuestion(item) {
      try {
        if (!confirm(`删除题目：${item.stem.slice(0, 24)}？`)) return;
        const client = await ensureClient();
        await requireSignedIn();
        const result = await client.from("questions").delete().eq("id", item.id);
        if (result.error) throw result.error;
        await loadAll(true);
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    async function removeSourceFile(item) {
      try {
        if (!confirm(`删除上传记录：${item.original_name}？`)) return;
        const client = await ensureClient();
        await requireSignedIn();
        if (item.storage_path) {
          const storageResult = await client.storage.from(CONFIG.bucket || "question-files").remove([item.storage_path]);
          if (storageResult.error) throw storageResult.error;
        }
        const result = await client.from("source_files").delete().eq("id", item.id);
        if (result.error) throw result.error;
        await loadAll();
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    async function startExam() {
      try {
        if (!examForm.value.level) throw new Error("请先选择考试等级");
        resetExamState();
        const levelObj = LEVELS.find((item) => item.value === examForm.value.level)
          || { value: examForm.value.level, label: examForm.value.level };
        const levelKeys = levelCountKeys(levelObj);
        const [singleCount, multipleCount, judgeCount] = await Promise.all([
          getQuestionCount(levelKeys, ["single"]),
          getQuestionCount(levelKeys, ["multiple"]),
          getQuestionCount(levelKeys, ["judge"]),
        ]);
        const plan = buildExamPlan({ single: singleCount, multiple: multipleCount, judge: judgeCount });
        if (!plan.total) throw new Error("当前等级还没有可用于考试的单选、多选或判断题");

        const [singles, multiples, judges] = await Promise.all([
          getRandomQuestionsByLevel(levelKeys, ["single"], plan.single),
          getRandomQuestionsByLevel(levelKeys, ["multiple"], plan.multiple),
          getRandomQuestionsByLevel(levelKeys, ["judge"], plan.judge),
        ]);
        examQuestions.value = [
          ...singles,
          ...multiples,
          ...judges,
        ];
        shuffleInPlace(examQuestions.value);
        examAnswers.value = {};
        examResult.value = null;
        examSecondsLeft.value = EXAM_RULE.minutes * 60;
        examStartedAt.value = Date.now();
        examTimer.value = window.setInterval(() => {
          const totalMs = EXAM_RULE.minutes * 60 * 1000;
          const remaining = Math.max(0, Math.ceil((totalMs - (Date.now() - examStartedAt.value)) / 1000));
          if (remaining !== examSecondsLeft.value) examSecondsLeft.value = remaining;
          if (remaining <= 0) {
            examSecondsLeft.value = 0;
            clearExamTimer();
            void submitExam();
          }
        }, 500);
        tab.value = "exam";
        if (!plan.full) {
          setMessage(`当前题库数量不足正式考试，已生成 ${plan.total} 题小型练习考。正式考试规则仍为 80 单选 + 10 多选 + 10 判断。`);
        }
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    function toggleExamAnswer(question, value) {
      const current = examAnswers.value[question.id] || [];
      if (question.question_type === "multiple") {
        examAnswers.value[question.id] = current.includes(value)
          ? current.filter((item) => item !== value)
          : [...current, value];
      } else {
        examAnswers.value[question.id] = [value];
      }
      if (examForm.value.mode === "memorize") {
        const next = new Set(examRevealSet.value);
        next.add(question.id);
        examRevealSet.value = next;
      }
    }

    async function submitExam() {
      try {
        if (examInProgress.value) return;
        examInProgress.value = true;
        clearExamTimer();
        const client = await ensureClient();
        await requireSignedIn();
        const wrongQuestions = [];
        const manualReview = [];
        let correctCount = 0;
        let autoScoredCount = 0;

        for (const question of examQuestions.value) {
          const submitted = normalizeAnswer(examAnswers.value[question.id] || []);
          if (question.question_type === "practical") {
            manualReview.push({ id: question.id, stem: question.stem });
            await insertAnswerRecord(client, {
              question_id: question.id,
              user_id: userId.value,
              answer: submitted.join(" "),
              correct: null,
              submitted_answer: submitted,
              is_correct: null,
            });
            continue;
          }

          const correct = normalizeAnswer(question.answer);
          const isCorrect = answersEqual(submitted, correct);
          autoScoredCount += 1;
          if (isCorrect) correctCount += 1;
          else wrongQuestions.push({ id: question.id, stem: question.stem, correctAnswer: correct.join(" ") });

          await insertAnswerRecord(client, {
            question_id: question.id,
            user_id: userId.value,
            answer: submitted.join(" "),
            correct: isCorrect,
            submitted_answer: submitted,
            is_correct: isCorrect,
          });
        }

        const total = examQuestions.value.length;
        const wrongCount = total - correctCount;
        const score = total ? Math.round((correctCount / total) * 100) : 0;
        const duration = examStartedAt.value ? Math.max(1, Math.floor((Date.now() - examStartedAt.value) / 1000)) : EXAM_RULE.minutes * 60;
        const recordResult = await client.from("exam_records").insert({
          user_id: userId.value,
          score,
          total,
          correct: correctCount,
          duration,
        });
        if (recordResult.error) throw recordResult.error;
        examResult.value = {
          score,
          passed: score >= EXAM_RULE.passScore,
          total,
          correctCount,
          wrongCount,
          correctRate: total ? Math.round((correctCount / total) * 100) : 0,
          autoScoredCount,
          manualReview,
          wrongQuestions,
          mode: examForm.value.mode,
          duration,
          durationText: formatDuration(duration),
        };
        await loadAll();
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        examInProgress.value = false;
      }
    }

    function validateCsvRows(rows) {
      const errors = [];
      const validRows = [];
      rows.forEach((row, index) => {
        const missing = CSV_REQUIRED_FIELDS.filter((field) => !String(row[field] || "").trim());
        const level = normalizeLevel(row.level);
        const options = [row.option_a, row.option_b, row.option_c, row.option_d].filter((item) => String(item || "").trim());
        if (missing.length) {
          errors.push(`第 ${index + 2} 行缺少 ${missing.join(", ")}`);
          return;
        }
        if (!LEVELS.some((item) => item.value === level)) {
          errors.push(`第 ${index + 2} 行等级无效`);
          return;
        }
        if (!options.length && !["√", "×"].some((item) => normalizeAnswer(row.answer).includes(item))) {
          errors.push(`第 ${index + 2} 行缺少选项`);
          return;
        }
        validRows.push({ ...row, level });
      });
      return { errors, validRows };
    }

    async function onPickCsv(event) {
      try {
        const file = event.target.files?.[0];
        if (!file) return;
        const rows = parseCsvText(await file.text());
        const { errors, validRows } = validateCsvRows(rows);
        csvImport.value = { file, rows, errors, validRows, imported: 0 };
        if (errors.length) setError(`CSV验证发现 ${errors.length} 个问题，请先检查预览。`);
        else setMessage(`CSV预览完成：${validRows.length} 行可导入。`);
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    async function importCsvQuestions() {
      try {
        const client = await ensureClient();
        await requireSignedIn();
        if (!csvImport.value.validRows.length) throw new Error("没有可导入的CSV行");
        const rows = await Promise.all(csvImport.value.validRows.map(async (row) => {
          const payload = csvRowToQuestion(row);
          const fingerprint = await makeFingerprint(payload);
          return { ...payload, fingerprint };
        }));
        const chapterRows = [...new Map(rows.filter((row) => row.chapter).map((row) => [
          `${row.level}:${row.chapter}`,
          { level: row.level, name: row.chapter },
        ])).values()];
        if (chapterRows.length) {
          const chapterResult = await client.from("chapters").upsert(chapterRows, { onConflict: "level,name", ignoreDuplicates: true });
          if (chapterResult.error) throw chapterResult.error;
        }
        const result = await insertQuestionBatches(client, rows);
        csvImport.value = { ...csvImport.value, imported: result.inserted };
        setMessage(`CSV导入完成：新增 ${result.inserted} 题，重复 ${result.duplicateOrSkipped} 题。`);
        await loadAll(true);
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    function clearChapterEditor() {
      chapterEditor.value = { id: null, level: "junior", name: "", sort_order: 0 };
    }

    function editChapter(item) {
      chapterEditor.value = {
        id: item.id,
        level: item.level,
        name: item.name,
        sort_order: item.sort_order || 0,
      };
    }

    async function saveChapter() {
      try {
        const client = await ensureClient();
        await requireSignedIn();
        const payload = {
          level: chapterEditor.value.level,
          name: chapterEditor.value.name,
          sort_order: Number(chapterEditor.value.sort_order) || 0,
        };
        if (!payload.name) throw new Error("章节名称不能为空");
        const result = chapterEditor.value.id
          ? await client.from("chapters").update(payload).eq("id", chapterEditor.value.id)
          : await client.from("chapters").insert(payload);
        if (result.error) throw result.error;
        setMessage(chapterEditor.value.id ? "章节已更新" : "章节已新增");
        clearChapterEditor();
        await loadAll();
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    async function deleteChapter(item) {
      try {
        if (!confirm(`删除章节：${item.name}？题目不会被删除。`)) return;
        const client = await ensureClient();
        await requireSignedIn();
        const result = await client.from("chapters").delete().eq("id", item.id);
        if (result.error) throw result.error;
        await loadAll();
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    async function refreshAll() {
      try {
        await loadDashboard();
        await loadAll(true);
        setMessage("数据已刷新");
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    function labelOfLevelLocal(value) {
      return labelOfLevel(value);
    }

    onMounted(async () => {
      try {
        await loadDashboard();
        await loadAll();
      } catch (err) {
        ready.value = false;
        setError(err.message || String(err));
      }
    });

    return {
      ready,
      tab,
      userId,
      profileName,
      profileForm,
      message,
      error,
      uploadStatus,
      levels: LEVELS,
      questionTypes: QUESTION_TYPES,
      aiAnalysisEnabled: AI_ANALYSIS_ENABLED,
      uploadForm,
      sourceFiles,
      questions,
      chapters,
      examRecords,
      favoriteSet,
      stats,
      levelDashboard,
      learningStats,
      todayTask,
      recentExams,
      chapterMastery,
      practiceFilter,
      wrongFilter,
      visibleQuestions,
      wrongQuestions,
      questionIndex,
      currentQuestion,
      currentStoredExplanation,
      selectedAnswers,
      practicalAnswer,
      practiceResult,
      practiceSubmitting,
      examForm,
      examRule: EXAM_RULE,
      examQuestions,
      examAnswers,
      examResult,
      examRevealSet,
      examCountdown,
      aiAnalysisByQuestionId,
      editor,
      editingId,
      managedQuestions,
      manageSearch,
      csvImport,
      chapterEditor,
      answeredCount,
      selectedUploadSummary,
      uploadButtonText,
      sourceName,
      labelOfLevel: labelOfLevelLocal,
      labelOfType,
      fillCurrentProfile,
      loginProfile,
      logoutProfile,
      onPickUploadFile,
      onPickUploadFolder,
      uploadAndParse,
      loadDashboard,
      resetPractice,
      shuffleQuestions,
      loadIntoPractice,
      enterLevel,
      jumpToQuestion,
      questionStatus,
      toggleAnswer,
      optionClass,
      nextQuestion,
      previousQuestion,
      toggleFavorite,
      submitPractice,
      requestAiAnalysis,
      editQuestion,
      clearEditor,
      saveQuestion,
      deleteQuestion,
      removeSourceFile,
      startExam,
      toggleExamAnswer,
      submitExam,
      toggleExamReveal,
      onPickCsv,
      importCsvQuestions,
      clearChapterEditor,
      editChapter,
      saveChapter,
      deleteChapter,
      resetWrongFilters,
      refreshAll,
    };
  },
}).mount("#app");
