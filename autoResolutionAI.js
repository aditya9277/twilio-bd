import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const STORAGE_PATH = process.env.LOGS_PATH; // Ensure directory for AI responses
const COMMON_ISSUES_FILE = path.join(STORAGE_PATH, "common_issues.json");

// Load predefined common issues & resolutions (self-learning system)
const loadCommonIssues = () => {
  if (fs.existsSync(COMMON_ISSUES_FILE)) {
    return JSON.parse(fs.readFileSync(COMMON_ISSUES_FILE, "utf8"));
  }
  return {};
};

// Save new resolutions for future auto-responses
const saveCommonIssue = (query, resolution) => {
  let commonIssues = loadCommonIssues();
  commonIssues[query] = resolution;
  fs.writeFileSync(COMMON_ISSUES_FILE, JSON.stringify(commonIssues, null, 2), "utf8");
};

// **Main function to process customer queries**
export async function handleAutoResolution(transcript, phoneNumber) {
  console.log(`🤖 AI Analyzing Customer Query for ${phoneNumber}: ${transcript}`);

  const commonIssues = loadCommonIssues();

  // ✅ Check if issue already has an AI-generated response
  for (const issue in commonIssues) {
    if (transcript.toLowerCase().includes(issue.toLowerCase())) {
      console.log(`✅ AI Found Pre-Solved Issue: ${issue}`);
      return { resolution: commonIssues[issue], autoResolved: true };
    }
  }

  // ❌ If no pre-existing solution, use Gemini AI to generate response
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      You are an AI support assistant for a BPO. A customer has asked the following question on a live call:
      "${transcript}"
      Your task:
      - Identify if this is a **common query** that can be answered without an agent.
      - If it's a common issue, provide a **clear and concise short one sentence response** in professional tone.
      - If it's a complex query requiring an agent, just reply: "Agent Required".
      - If you get in the transcript or the customer says, I want to talk to agent, just reply: "Agent Required".
    `;

    const aiResponse = await model.generateContent(prompt);
    const responseText = aiResponse.response.text().trim();

    if (responseText.toLowerCase().includes("agent required")) {
      console.log(`📞 Issue Requires Agent for ${phoneNumber}.`);
      return { resolution: "This issue needs an agent.", autoResolved: false };
    }

    console.log(`✅ AI-Generated Response: ${responseText}`);

    // Save the new AI-generated response for future use
    saveCommonIssue(transcript, responseText);

    return { resolution: responseText, autoResolved: true };
  } catch (error) {
    console.error("❌ AI Auto-Resolution Error:", error);
    return { resolution: "Error processing request. Redirecting to agent.", autoResolved: false };
  }
}
