import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_PATH = process.env.LOGS_PATH || path.join(__dirname, 'logs');
const KNOWLEDGE_DB = path.join(STORAGE_PATH, 'knowledge_base.json'); // ✅ Store AI solutions
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ Ensure the knowledge base file exists
if (!fs.existsSync(KNOWLEDGE_DB)) {
  fs.writeFileSync(KNOWLEDGE_DB, JSON.stringify([]));
}

// **Fetch AI-generated solutions or existing ones**
export async function fetchKnowledgeResponse(query, forceGenerate = false) {
  try {
    // Load existing knowledge base data
    const knowledgeBase = JSON.parse(fs.readFileSync(KNOWLEDGE_DB, "utf8"));

    // ✅ Check if an answer already exists
    const existingAnswer = knowledgeBase.find((entry) =>
      entry.question.toLowerCase().includes(query.toLowerCase())
    );

    if (existingAnswer && !forceGenerate) {
      console.log("🔍 Returning existing knowledge:", existingAnswer.answer);
      return { source: "database", answer: existingAnswer.answer };
    }

    if (!forceGenerate) {
      console.log("❌ No direct match found. Returning suggestions...");
      const suggestions = knowledgeBase
        .filter((entry) => entry.question.toLowerCase().includes(query.toLowerCase()))
        .map((entry) => entry.question);
      return { source: "database", suggestions };
    }

    console.log("🤖 Querying Gemini AI for:", query);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const aiResponse = await model.generateContent(`
      Act as a knowledge base assistant for call center agents.
      Provide a **concise and professional solution** for the following query:

      Query: "${query}"

      Response should be **precise and actionable**.
      If no direct match is found, provide **general guidance**.
      Only return the solution, no extra text.
    `);

    const solution = aiResponse.response.text();

    // ✅ Store new AI response in database
    knowledgeBase.push({ question: query, answer: solution });
    fs.writeFileSync(KNOWLEDGE_DB, JSON.stringify(knowledgeBase, null, 2));

    console.log("✅ AI Response Stored:", solution);
    return { source: "AI", answer: solution };
  } catch (error) {
    console.error("❌ Error fetching AI response:", error);
    return { source: "error", answer: "Sorry, I couldn't find an answer." };
  }
}
