import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";

dotenv.config();

const STORAGE_PATH = process.env.LOGS_PATH;
export async function triggerEscalation(transcript, sentiment, phoneNumber) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY2);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    // Ask Gemini to summarize the reason for escalation
    const aiResponse = await model.generateContent(
      `Given this customer conversation excerpt:\n"${transcript}"\n\nFor example, in our case if you get any word like *legal* , Identify a concise reason for escalation (only return the reason, no extra text):`
    );

    const conciseReason = aiResponse.response.text().trim();

    // Create escalation entry with Gemini-generated reason
    const escalationData = {
      timestamp: new Date().toISOString(),
      phoneNumber: phoneNumber,
      reason: conciseReason, // Use Gemini’s concise reason
      sentiment: sentiment, // Keep sentiment for analysis
    };

    // Store per phone number
    const escalationFile = path.join(STORAGE_PATH, `escalation_${phoneNumber}.txt`);

    // Append to file or create new if doesn't exist
    fs.appendFileSync(escalationFile, JSON.stringify(escalationData) + "\n", "utf8");
    console.log(`⚠️ Escalation Logged for ${phoneNumber}: ${conciseReason}`);
  } catch (error) {
    console.error("❌ Gemini AI Error:", error);
  }
}