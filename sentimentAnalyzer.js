import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

// ✅ Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ Function to Analyze Sentiment
export async function analyzeSentiment(transcript) {
  if (!transcript.trim()) return "Neutral"; // ✅ Avoid sending empty text

  console.log("🧐 Analyzing Sentiment for Transcript:", transcript);

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  try {
    const prompt = `Analyze the following customer conversation and provide only one or two words as sentiment (e.g., Positive, Negative, Frustrated, Disappointed, Neutral):\n\n${transcript}`;
    
    const aiResponse = await model.generateContent(prompt);
    const sentiment = aiResponse.response.text().trim();

    console.log("💬 Customer Sentiment:", sentiment);

    // ✅ Save sentiment to a file for reference
    fs.appendFileSync("sentiments.txt", `Transcript: ${transcript}\nSentiment: ${sentiment}\n\n`, "utf8");

    return sentiment; // ✅ Return sentiment for further use if needed
  } catch (error) {
    console.error("❌ Sentiment Analysis Error:", error);
    return "Error";
  }
}
