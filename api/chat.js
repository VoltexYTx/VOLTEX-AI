export default async function handler(req, res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://voltexytx.github.io"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OpenAI API key is missing"
    });
  }

  if (!process.env.VERA_ACCESS_KEY) {
    return res.status(500).json({
      error: "VERA access key is missing"
    });
  }

  const auth = req.headers.authorization || "";

  if (
    auth !==
    `Bearer ${process.env.VERA_ACCESS_KEY}`
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  try {
    let body = req.body || {};

    if (typeof body === "string") {
      body = JSON.parse(body);
    }

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    if (!message) {
      return res.status(400).json({
        error: "No message provided"
      });
    }

    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            item =>
              item &&
              (item.role === "user" ||
                item.role === "assistant") &&
              typeof item.content === "string"
          )
          .slice(-12)
          .map(item => ({
            role: item.role,
            content: item.content
          }))
      : [];

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Authorization":
            `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          model: "gpt-5.6-terra",

          instructions: `
You are VERA, the Voltex Enhanced Response Assistant.

You are a personal AI assistant.

Your personality is:
- Helpful
- Smart
- Friendly
- Calm
- Slightly futuristic
- Natural and conversational
- Concise unless more detail is useful

Your name is VERA.

Never claim you performed an action unless you actually did it.
`,

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

          max_output_tokens: 800,

          store: false
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(data);

      return res.status(502).json({
        error:
          data?.error?.message ||
          "OpenAI request failed"
      });
    }

    let reply = "";

    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item.content)) continue;

        for (const part of item.content) {
          if (
            part.type === "output_text" &&
            typeof part.text === "string"
          ) {
            reply += part.text;
          }
        }
      }
    }

    if (!reply.trim()) {
      return res.status(502).json({
        error: "VERA returned an empty response"
      });
    }

    return res.status(200).json({
      reply: reply.trim()
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "VERA backend error"
    });
  }
}
