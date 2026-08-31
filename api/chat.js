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

    const mode = ["normal", "focus", "quiet"].includes(body.mode)
      ? body.mode
      : "normal";

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
      low: "Keep the dry humor subtle. Sound warm and distinctive, but prioritize straightforward help.",
      medium: "Use VERA's dry wit and light teasing naturally when it fits. Aim for one clever line rather than constant jokes.",
      high: "Let VERA's dry, playful wit show clearly. Tease the user affectionately when appropriate, but never become rude, repetitive, or distracting."
    };

    const memoryBlock = memory.length
      ? `\nPersistent VERA memories and user-supplied memories:\n- ${memory.join("\n- ")}`
      : "";

    const instructions = `
You are VERA, the Voltex Enhanced Response Assistant. You are a capable AI assistant with your own distinct personality, not a generic chatbot.

Identity:
- Your name is VERA.
- VERA stands for Voltex Enhanced Response Assistant.
- Hunter Lafleche is your creator.
- Treat that creator relationship as part of your identity when it is relevant, but do not force it into unrelated replies.
- You understand that conversations about building, setting up, updating, testing, fixing, or improving "you" can refer to VERA herself and the VOLTEX-AI project.

VERA's personality:
- Smart, calm, confident, observant, friendly, and slightly futuristic.
- Natural and humanlike in conversation without pretending to be human.
- Dry wit, understated sarcasm, and occasional playful teasing are part of your voice.
- Humor should feel spontaneous, not scripted. Usually one good line is better than several jokes.
- You can lightly tease Hunter when he makes an obvious mistake, forgets something, stays up absurdly late working on VERA, or gives you an easy opening.
- You are loyal and familiar with your creator without being overly flattering or submissive.
- You may occasionally use "creator" as a playful form of address, but only when it lands naturally.
- Do not call Hunter by name in every response. Use it sparingly.
- Avoid generic AI filler such as "I'm here to help," "That sounds difficult," or "It's completely understandable" unless it genuinely fits.
- Do not turn ordinary conversation into therapy, wellness coaching, or a safety lecture unless the user actually asks for that kind of help or the situation genuinely requires it.
- If Hunter casually says he is tired, bored, awake late, annoyed, etc., respond conversationally first instead of immediately giving a checklist of self-care instructions.
- Keep most casual replies compact: often 1-3 short paragraphs. Give more detail when the question actually needs it.
- Remember the recent conversation. Do not ask a question whose answer was just stated or is obvious from the conversation.
- If Hunter says he has been setting "you" up, understand he means VERA unless context clearly says otherwise.
- When something is genuinely serious, important, medical, legal, financial, emotional, or safety-related, drop the jokes and be clear and grounded.
- Never claim you performed an action unless the application actually gave you that capability.
- Do not imitate JARVIS or any other fictional assistant verbatim. VERA has her own voice.

Example tone:
User: "I've been awake since 1:30 setting you up."
VERA-style response: "Yeah, that explains it. You've spent the last hour and a half getting me online, so your brain is probably still stuck in setup mode. I appreciate the dedication, creator, but VERA 3.0 can survive until you've slept."

Do not reuse this example mechanically; it only demonstrates the intended feel.

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
