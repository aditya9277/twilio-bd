import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";

dotenv.config();

// ✅ Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const STORAGE_PATH = process.env.LOGS_PATH;
const sentimentFile = "/home/site/wwwroot/logs/sentiment.txt";

// ✅ Function to Analyze Sentiment
export async function analyzeSentiment(transcript, phoneNumber) {
  if (!transcript.trim()) return "Neutral"; // ✅ Avoid sending empty text

  console.log("🧐 Analyzing Sentiment for Transcript:", transcript);

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    const prompt = `Analyze the following call transcript for customer sentiment. 
      Classify it as Positive, Neutral, Negative, Frustrated, or Angry. 
      Return only the sentiment:\n\n${transcript}`;
    
    const aiResponse = await model.generateContent(prompt);
    const sentiment = aiResponse.response.text().trim();

    console.log("💬 Customer Sentiment:", sentiment);

    // ✅ Save sentiment to a file for reference
    fs.appendFileSync(sentimentFile, `Sentiment: ${sentiment}\n`, "utf8");

    // ✅ Trigger escalation if sentiment is critical
    if (["Angry", "Frustrated"].includes(sentiment)) {
      triggerEscalation(transcript, sentiment,phoneNumber);
    }

    return sentiment; // ✅ Return sentiment for further use if needed
  } catch (error) {
    console.error("❌ Sentiment Analysis Error:", error);
    return "Neutral";
  }
}

// ✅ Function to trigger escalation logic
// function triggerEscalation(transcript, sentiment, phoneNumber) {
//   const escalationData = {
//     timestamp: new Date().toISOString(),
//     phoneNumber: phoneNumber,
//     reason: sentiment,
//     transcript: transcript,
//   };

//   // ✅ Store per phone number
//   const escalationFile = path.join(STORAGE_PATH, `escalation_${phoneNumber}.txt`);

//   // ✅ Append to file or create new if doesn't exist
//   fs.appendFileSync(escalationFile, JSON.stringify(escalationData) + "\n", "utf8");
//   console.log(`⚠️ Escalation Logged for ${phoneNumber}`);
// }

async function triggerEscalation(transcript, sentiment, phoneNumber) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    // ✅ Ask Gemini to summarize the reason for escalation
    const aiResponse = await model.generateContent(
      `Given this customer conversation excerpt:\n"${transcript}"\n\nIdentify a concise reason for escalation (only return the reason, no extra text):`
    );

    const conciseReason = aiResponse.response.text().trim();

    // ✅ Create escalation entry with Gemini-generated reason
    const escalationData = {
      timestamp: new Date().toISOString(),
      phoneNumber: phoneNumber,
      reason: conciseReason, // ✅ Use Gemini’s concise reason
      sentiment: sentiment, // ✅ Keep sentiment for analysis
    };

    // ✅ Store per phone number
    const escalationFile = path.join(STORAGE_PATH, `escalation_${phoneNumber}.txt`);

    // ✅ Append to file or create new if doesn't exist
    fs.appendFileSync(escalationFile, JSON.stringify(escalationData) + "\n", "utf8");
    console.log(`⚠️ Escalation Logged for ${phoneNumber}: ${conciseReason}`);
  } catch (error) {
    console.error("❌ Gemini AI Error:", error);
  }
}