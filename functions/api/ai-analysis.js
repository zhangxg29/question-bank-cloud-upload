const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-luna";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function formatQuestion(question) {
  const options = Array.isArray(question.options) && question.options.length
    ? question.options.map((item) => `${item.key}. ${item.text}`).join("\n")
    : "No options / practical question";

  return [
    `Question type: ${question.question_type || "unknown"}`,
    `Level: ${question.level || "unknown"}`,
    `Stem: ${question.stem || ""}`,
    `Options:\n${options}`,
    `Correct answer: ${question.answer || "not provided"}`,
    `Existing explanation: ${question.explanation || "none"}`,
  ].join("\n");
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return json({ ok: true });
  }

  if (request.method !== "POST") {
    return json({ error: "Only POST is supported." }, 405);
  }

  if (!env.OPENAI_API_KEY) {
    return json({ error: "OPENAI_API_KEY is not configured in Cloudflare Pages environment variables." }, 500);
  }

  try {
    const body = await request.json();
    const question = body.question;

    if (!question || !question.stem) {
      return json({ error: "Missing question payload." }, 400);
    }

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || DEFAULT_MODEL,
        reasoning: { effort: "low" },
        text: { verbosity: "low" },
        input: [
          {
            role: "system",
            content: [
              "You are a vocational exam question explanation teacher.",
              "Always answer in Simplified Chinese.",
              "Give concise, accurate explanations for exam review.",
              "For multiple-choice questions, explain why the correct option is correct and mention common traps.",
              "For true/false questions, explain the judgment basis.",
              "For practical questions, give operation points and scoring concerns.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Please explain this question in 200-400 Chinese characters:\n\n${formatQuestion(question)}`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return json({ error: data.error?.message || "OpenAI request failed." }, response.status);
    }

    const text = data.output_text
      || (data.output || [])
        .flatMap((item) => item.content || [])
        .map((item) => item.text || "")
        .join("\n")
        .trim();

    return json({ analysis: text || "AI did not return analysis content." });
  } catch (error) {
    return json({ error: error.message || String(error) }, 500);
  }
}
