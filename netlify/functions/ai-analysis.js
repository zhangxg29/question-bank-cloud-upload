const OPENAI_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-luna";

function response(payload, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
    body: JSON.stringify(payload),
  };
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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return response({ ok: true });
  }

  if (event.httpMethod !== "POST") {
    return response({ error: "Only POST is supported." }, 405);
  }

  if (!process.env.OPENAI_API_KEY) {
    return response({ error: "OPENAI_API_KEY is not configured in Netlify environment variables." }, 500);
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const question = body.question;

    if (!question || !question.stem) {
      return response({ error: "Missing question payload." }, 400);
    }

    const aiResponse = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
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

    const data = await aiResponse.json();

    if (!aiResponse.ok) {
      return response({ error: data.error?.message || "OpenAI request failed." }, aiResponse.status);
    }

    const text = data.output_text
      || (data.output || [])
        .flatMap((item) => item.content || [])
        .map((item) => item.text || "")
        .join("\n")
        .trim();

    return response({ analysis: text || "AI did not return analysis content." });
  } catch (error) {
    return response({ error: error.message || String(error) }, 500);
  }
};
