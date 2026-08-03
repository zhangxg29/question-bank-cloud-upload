import { createClient } from "./vendor/supabase.mjs";

const CONFIG = window.APP_CONFIG || {};
const QUESTION_DB_NAME = "question_bank_db";
const QUESTION_DB_VERSION = 1;
const QUESTION_STORE = "questions";
const QUESTION_CACHE_TTL_MS = 10 * 60 * 1000;

function openQuestionDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUESTION_DB_NAME, QUESTION_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUESTION_STORE)) {
        db.createObjectStore(QUESTION_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openQuestionDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUESTION_STORE, "readonly");
    const req = tx.objectStore(QUESTION_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openQuestionDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUESTION_STORE, "readwrite");
    tx.objectStore(QUESTION_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const hasSupabaseConfig = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
export const supabaseClient = hasSupabaseConfig
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  : null;

if (supabaseClient) {
  window.supabaseClient = supabaseClient;
}

function normalizeAnswer(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value == null) return [];
  const text = String(value).trim();
  if (!text) return [];
  if (/^(√|对|正确|true|t|1)$/i.test(text)) return ["√"];
  if (/^(×|错|错误|false|f|0)$/i.test(text)) return ["×"];
  const tokens = text.toUpperCase().match(/[A-H]|√|×/g);
  return tokens ? [...new Set(tokens)] : [text];
}

function inferQuestionType(row) {
  if (row.question_type) return row.question_type;
  const answer = normalizeAnswer(row.answer);
  if (answer.includes("√") || answer.includes("×")) return "judge";
  if (answer.length > 1) return "multiple";
  return "single";
}

function normalizeOptions(row) {
  if (Array.isArray(row.options) && row.options.length) return row.options;
  return [
    ["A", row.option_a],
    ["B", row.option_b],
    ["C", row.option_c],
    ["D", row.option_d],
  ]
    .filter(([, text]) => String(text || "").trim())
    .map(([key, text]) => ({ key, text: String(text).trim() }));
}

export function normalizeQuestionRow(row) {
  return {
    ...row,
    stem: row.stem || row.question || "",
    question: row.question || row.stem || "",
    options: normalizeOptions(row),
    option_a: row.option_a || (row.options || []).find((item) => item.key === "A")?.text || "",
    option_b: row.option_b || (row.options || []).find((item) => item.key === "B")?.text || "",
    option_c: row.option_c || (row.options || []).find((item) => item.key === "C")?.text || "",
    option_d: row.option_d || (row.options || []).find((item) => item.key === "D")?.text || "",
    answer: normalizeAnswer(row.answer),
    explanation: row.explanation || row.analysis || "",
    analysis: row.analysis || row.explanation || "",
    question_type: inferQuestionType(row),
    chapter: row.chapter || "",
    profession: row.profession || "输气工",
    scope: row.scope || (["common", "通用", "通用基础知识"].includes(row.level) ? "common" : "level"),
  };
}

export async function getCurrentAuthUser() {
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient.auth.getUser();
  if (error) return null;
  return data?.user || null;
}

export async function signInWithPassword(email, password) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  return supabaseClient.auth.signInWithPassword({ email, password });
}

export async function signUpWithPhone(phone, password, displayName) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  return supabaseClient.auth.signUp({
    phone,
    password,
    options: {
      data: {
        display_name: displayName,
        full_name: displayName,
      },
    },
  });
}

export async function signInWithPhone(phone, password) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  return supabaseClient.auth.signInWithPassword({ phone, password });
}

export async function signUpWithPassword(email, password, displayName) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  return supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        full_name: displayName,
      },
    },
  });
}

export async function signOutUser() {
  if (!supabaseClient) return { error: null };
  return supabaseClient.auth.signOut();
}

export async function resolveUserId() {
  const user = await getCurrentAuthUser();
  return user?.id || "";
}

async function fetchQuestionPages(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const result = await buildQuery().range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function getQuestions() {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  const rows = await fetchQuestionPages(() => supabaseClient.from("questions").select("*").order("id", { ascending: false }));
  return rows.map(normalizeQuestionRow);
}

export async function getQuestionsCached({ force = false, ttlMs = QUESTION_CACHE_TTL_MS } = {}) {
  if (!force) {
    try {
      const cached = await idbGet("questions");
      if (cached && Array.isArray(cached.data) && Date.now() - (cached.savedAt || 0) < ttlMs) {
        return cached.data;
      }
    } catch (err) {
      console.warn("题库缓存读取失败，将重新拉取", err);
    }
  }
  try {
    const rows = await getQuestions();
    try {
      await idbSet("questions", { savedAt: Date.now(), data: rows });
    } catch (err) {
      console.warn("题库缓存写入失败（继续使用网络数据）", err);
    }
    return rows;
  } catch (err) {
    // 网络不可用时回退到任意旧缓存，保证离线能刷题
    try {
      const cached = await idbGet("questions");
      if (cached && Array.isArray(cached.data) && cached.data.length) {
        console.warn("网络不可用，使用本地题库缓存（离线模式）", err);
        return cached.data;
      }
    } catch (err2) {
      // ignore
    }
    throw err;
  }
}

export async function getLocalBankVersion() {
  try {
    return (await idbGet("bank_version")) || "";
  } catch (err) {
    return "";
  }
}

export async function setLocalBankVersion(value) {
  try {
    await idbSet("bank_version", String(value || ""));
  } catch (err) {
    // ignore
  }
}

export async function getBankVersion() {
  if (!supabaseClient) return "";
  const result = await supabaseClient.from("app_meta").select("value").eq("key", "bank_version").maybeSingle();
  if (result.error) return "";
  return result.data?.value || "";
}

export async function setBankVersion(value) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  const result = await supabaseClient.from("app_meta").upsert(
    { key: "bank_version", value: String(value) },
    { onConflict: "key" }
  );
  if (result.error) throw result.error;
  return result;
}

export async function addQuestionFeedback(questionId, message) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  const userId = await resolveUserId();
  const result = await supabaseClient.from("question_feedback").insert({
    question_id: questionId,
    user_id: userId,
    message,
    status: "pending",
  });
  if (result.error) throw result.error;
  return result;
}

export async function getQuestionFeedback(status = "pending") {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  let query = supabaseClient.from("question_feedback").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const result = await query;
  if (result.error) throw result.error;
  return result.data || [];
}

export async function updateFeedbackStatus(id, status) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  const result = await supabaseClient.from("question_feedback").update({ status }).eq("id", id);
  if (result.error) throw result.error;
  return result;
}

export async function getQuestionCount(level, types = null) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  let query = supabaseClient.from("questions").select("*", { count: "exact", head: true });
  if (Array.isArray(level) && level.length > 1) {
    query = query.in("level", level);
  } else if (Array.isArray(level) && level.length === 1) {
    query = query.eq("level", level[0]);
  } else if (level) {
    query = query.eq("level", level);
  }
  if (Array.isArray(types) && types.length) {
    query = query.in("question_type", types);
  }
  const result = await query;
  if (result.error) throw result.error;
  return result.count || 0;
}

export async function getRandomQuestions(number = 100) {
  return getRandomQuestionsByLevel(null, null, number);
}

export async function getRandomQuestionsByLevel(level, types, count) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  const result = await supabaseClient.rpc("random_questions", {
    p_levels: Array.isArray(level) ? level : level ? [level] : null,
    p_types: types && types.length ? types : null,
    p_limit: Math.max(0, Number(count) || 0),
  });
  if (result.error) throw result.error;
  return (result.data || []).map(normalizeQuestionRow);
}
