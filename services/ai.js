const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function extractAiData(transcript) {
  const prompt = `
Extract the following fields from this phone call transcript:

Transcript:
"""
${transcript}
"""

Return ONLY valid JSON with *no explanations*, no markdown, no commentary, no backticks, no code fences.

JSON structure:
{
  "firstName": "",
  "lastName": "",
  "email": "",
  "businessName": "",
  "summary": ""
}
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Return ONLY valid JSON. Do NOT wrap it in ```json```." },
      { role: "user", content: prompt }
    ]
  });

  let raw = response.choices[0].message.content || "";

  // --------------------------
  // CLEAN RAW MODEL OUTPUT
  // --------------------------

  // 1. Remove code blocks if present
  raw = raw.replace(/```json/gi, "");
  raw = raw.replace(/```/g, "");
  raw = raw.trim();

  // 2. Extract only outermost JSON object
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1) {
    raw = raw.substring(firstBrace, lastBrace + 1);
  }

  // 3. Parse JSON safely
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("AI JSON parse error:", e, "\nRAW CONTENT:\n", raw);
    return null;
  }
}

module.exports = { extractAiData };
