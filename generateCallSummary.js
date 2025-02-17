import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const STORAGE_PATH =process.env.LOGS_PATH || path.join(__dirname, "logs");

// ✅ Ensure logs directory exists
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH);
}

// ✅ Function to generate call summary
export async function generateCallSummary(phoneNumber) {
  try {
    const transcriptFile = path.join(STORAGE_PATH, `transcript_${phoneNumber}.txt`);
    const sentimentFile = path.join(STORAGE_PATH, `sentiment_${phoneNumber}.txt`);
    const summaryFile = path.join(STORAGE_PATH, `call_summary_${phoneNumber}.txt`);

    // ✅ Ensure transcript exists
    if (!fs.existsSync(transcriptFile)) {
      console.log(`❌ No transcript found for ${phoneNumber}`);
      return;
    }

    // ✅ Read transcript & sentiment
    const transcript = fs.readFileSync(transcriptFile, "utf8").trim();
    const sentiment = fs.existsSync(sentimentFile) ? fs.readFileSync(sentimentFile, "utf8").trim() : "Neutral";

    console.log("📜 Generating call summary for:", phoneNumber);

    // ✅ Generate AI Summary
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const aiResponse = await model.generateContent(`
      You are a call center assistant. Generate a **brief and professional summary** of the call using the given **transcript and sentiment**.
      - Summarize the customer's **main issue**.
      - Mention **key actions taken** by the agent.
      - Keep it **concise (4-5 bullet points)**.
      - **Sentiment Analysis**: ${sentiment}
      
      Call Transcript:
      """${transcript}"""
      
      Summary:
    `);

    const summary = aiResponse.response.text();

    console.log("✅ Call Summary Generated!");
    fs.writeFileSync(summaryFile, summary, "utf8");

    return summary;
  } catch (error) {
    console.error("❌ Error generating call summary:", error);
    return null;
  }
}
