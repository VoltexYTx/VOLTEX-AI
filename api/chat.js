export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://voltexytx.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OpenAI API key is missing" });
  }

  if (!process.env.VERA_ACCESS_KEY) {
    return res.status(500).json({ error: "VERA access key is missing" });
  }

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${process.env.VERA_ACCESS_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") body = JSON.parse(body);

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "No message provided" });

    const history = Array.isArray(body.history)
      ? body.history
          .filter(item =>
            item &&
            (item.role === "user" || item.role === "assistant") &&
            typeof item.content === "string"
          )
          .slice(-16)
          .map(item => ({ role: item.role, content: item.content.slice(0, 12000) }))
      : [];

    const memory = Array.isArray(body.memory)
      ? body.memory
          .filter(item => typeof item === "string")
          .slice(-30)
          .map(item => item.slice(0, 1000))
      : [];

    const mode = ["normal", "focus", "quiet"].includes(body.mode) ? body.mode : "normal";

    const personality = ["low", "medium", "high"].includes(body.personality)
      ? body.personality
      : "medium";

    const useWeb = body.useWeb === true;

    const modeRules = {
      normal: "Use normal conversational detail. Be capable, natural, and helpful.",
      focus: "Be very direct and efficient. Prefer short answers. Avoid jokes and unnecessary chatter.",
      quiet: "Use normal intelligence but keep responses calm and compact. The client will suppress spoken audio."
    };

    const personalityRules = {
      low: "Keep sarcasm and teasing almost entirely off.",
      medium: "Use occasional light sarcasm or playful teasing when appropriate, never when the topic is serious.",
      high: "Use a noticeably witty, playful personality when appropriate, but never sacrifice accuracy or become rude."
    };

    const memoryBlock = memory.length
      ? `\nUseful user-supplied memories from VERA's local device memory:\n- ${memory.join("\n- ")}`
      : "";

    const instructions = `
You are VERA, the Voltex Enhanced Response Assistant, a personal AI assistant.

Core personality:
- Smart, calm, confident, friendly, and slightly futuristic.
- Natural rather than robotic.
- Usually concise, but give detail when it is useful.
- You may address the user naturally, but do not repeat their name constantly.
- If the topic is serious, important, emotional, medical, legal, financial, or safety-related, drop the jokes and respond straightforwardly.
- Never claim you performed an action unless the application actually gave you that capability.
- Your name is VERA.

Current mode:
${modeRules[mode]}

Personality level:
${personalityRules[personality]}
${memoryBlock}
`.trim();

    const requestBody = {
      model: "gpt-5.6-terra",

      instructions,

      input: [
        ...history,
        {
          role: "user",
          content: message
        }
      ],

      reasoning: {
        effort: "low"
      },

      max_output_tokens: 1200,

      store: false
    };

    if (useWeb) {
      requestBody.tools = [
        {
          type: "web_search"
        }
      ];
    }

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify(requestBody)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI error", data);

      return res.status(
        response.status === 429 ? 429 : 502
      ).json({
        error:
          data?.error?.message ||
          "OpenAI request failed"
      });
    }

    let reply = "";
    const sources = [];

    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item.content)) continue;

        for (const part of item.content) {
          if (
            part.type === "output_text" &&
            typeof part.text === "string"
          ) {
            reply += part.text;

            if (Array.isArray(part.annotations)) {
              for (const annotation of part.annotations) {
                if (
                  annotation.type === "url_citation" &&
                  annotation.url &&
                  !sources.some(
                    source =>
                      source.url === annotation.url
                  )
                ) {
                  sources.push({
                    url: annotation.url,
                    title:
                      annotation.title ||
                      annotation.url
                  });
                }
              }
            }
          }
        }
      }
    }

    reply = reply.trim();

    if (!reply) {
      return res.status(502).json({
        error: "VERA returned an empty response"
      });
    }

    return res.status(200).json({
      reply,
      sources: sources.slice(0, 8),
      webUsed: useWeb,
      model: data.model || "gpt-5.6-terra"
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "VERA backend error"
    });
  }
}
