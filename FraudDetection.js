import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const STORAGE_PATH = process.env.LOGS_PATH || path.join(__dirname, 'logs');
const HISTORY_FILE = path.join(STORAGE_PATH, "customer_history.json"); //  Self-learning AI storage

// ✅ Ensure directory exists
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH);
}

// ✅ Function to analyze transcripts and detect fraud
export async function analyzeCustomerBehavior(phoneNumber) {
  const transcriptFile = path.join(STORAGE_PATH, `transcript_${phoneNumber}.txt`);

  // ✅ Check if transcript file exists
  if (!fs.existsSync(transcriptFile)) {
    console.log(`❌ No transcript found for ${phoneNumber}`);
    return;
  }

  // ✅ Read the transcript
  const transcript = fs.readFileSync(transcriptFile, "utf8").trim();
  if (!transcript) return;

  console.log(`📖 Analyzing past transcript for ${phoneNumber}`);

  // ✅ Initialize Gemini AI
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY2);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    // ✅ AI Prompt for Fraud Detection
    const aiResponse = await model.generateContent(`
      You are an AI analyzing call transcripts for fraud detection, abusive language, and time-wasting tactics. 

      - Detect if the customer has attempted fraud, repeated unnecessary calls, or used abusive words.
      - Provide a short and precise summary of the issue in a single sentence.
      - If nothing suspicious is found, return: "No suspicious activity detected."

      **Transcript to analyze:** 
      ${transcript}
    `);

    const aiGeneratedFlag = aiResponse.response.text().trim();

    console.log(`🚨 AI Fraud Detection Result for ${phoneNumber}:`, aiGeneratedFlag);

    // ✅ Load existing customer history
    let customerHistory = {};
    if (fs.existsSync(HISTORY_FILE)) {
      customerHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    }

    // ✅ Update history
    customerHistory[phoneNumber] = {
      phoneNumber,
      lastCallDate: new Date().toISOString(),
      fraudStatus: aiGeneratedFlag,
    };

    // ✅ Save updated history
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(customerHistory, null, 2), "utf8");
    console.log(`✅ Customer history updated for ${phoneNumber}`);
  } catch (error) {
    console.error("❌ Error in AI fraud analysis:", error);
  }
}
