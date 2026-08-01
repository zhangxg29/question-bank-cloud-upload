import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const CONFIG = window.APP_CONFIG || {};
const USER_ID_KEY = "question_bank_user_id";

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

function levelAliases(level) {
  const map = {
    junior: "初级",
    middle: "中级",
    senior: "高级",
    technician: "技师",
    senior_technician: "高级技师",
  };
  return [...new Set([level, map[level]].filter(Boolean))];
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
  };
}

export function getClientUserId() {
  const existing = localStorage.getItem(USER_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
      (Number(char) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(char) / 4).toString(16)
    );
  localStorage.setItem(USER_ID_KEY, id);
  return id;
}

export async function resolveUserId() {
  if (!supabaseClient) return getClientUserId();
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const sessionUser = sessionData?.session?.user?.id;
  if (sessionUser) {
    localStorage.setItem(USER_ID_KEY, sessionUser);
    return sessionUser;
  }

  if (CONFIG.useAnonymousAuth === true) {
    try {
      const signInResult = await supabaseClient.auth.signInAnonymously();
      if (!signInResult.error && signInResult.data?.user?.id) {
        localStorage.setItem(USER_ID_KEY, signInResult.data.user.id);
        return signInResult.data.user.id;
      }
      console.warn("Supabase匿名登录未启用，已使用本地用户标识。", signInResult.error);
    } catch (err) {
      console.warn("Supabase匿名登录失败，已使用本地用户标识。", err);
    }
  }

  return getClientUserId();
}

export async function getQuestions() {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  const result = await supabaseClient.from("questions").select("*").order("id", { ascending: false });
  if (result.error) throw result.error;
  return (result.data || []).map(normalizeQuestionRow);
}

export async function getQuestionCount(level) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  let query = supabaseClient.from("questions").select("*", { count: "exact", head: true });
  if (Array.isArray(level) && level.length > 1) {
    query = query.in("level", level);
  } else if (Array.isArray(level) && level.length === 1) {
    query = query.eq("level", level[0]);
  } else if (level) {
    query = query.eq("level", level);
  }
  const result = await query;
  if (result.error) throw result.error;
  return result.count || 0;
}

export async function getQuestionsByLevel(level) {
  if (!supabaseClient) throw new Error("请先填写 app-config.js");
  const result = await supabaseClient
    .from("questions")
    .select("*")
    .in("level", levelAliases(level))
    .order("id", { ascending: false });
  if (result.error) throw result.error;
  return (result.data || []).map(normalizeQuestionRow);
}

export async function getRandomQuestions(number = 100) {
  const list = await getQuestions();
  return [...list].sort(() => Math.random() - 0.5).slice(0, number);
}
