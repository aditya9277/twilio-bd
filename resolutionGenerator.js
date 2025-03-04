import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const STORAGE_PATH = process.env.LOGS_PATH || path.join(__dirname, 'logs');
const RESOLUTION_FILE = path.join(STORAGE_PATH, "resolutions.json");

// Ensure resolutions.json exists
if (!fs.existsSync(RESOLUTION_FILE)) fs.writeFileSync(RESOLUTION_FILE, JSON.stringify([]), "utf8");

// Function to generate AI-powered resolutions live
export async function getResolution(issue) {
  try {
    let resolutions = JSON.parse(fs.readFileSync(RESOLUTION_FILE, "utf8"));

    // Check for existing resolutions
    const existingResolution = resolutions.find((r) => issue.includes(r.issue));
    if (existingResolution) {
      console.log("Found existing resolution:", existingResolution.resolution);
      return existingResolution.resolution;
    }

    console.log("🤖 No existing resolution found, querying Gemini AI...");

    // Generate a new resolution using Gemini AI
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY2);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const aiResponse = await model.generateContent(
      `The following issue was encountered during a call:\n"${issue}"\nProvide a professional resolution in short crisp 2-3 points, each in new line respectively, that an agent should follow:`
    );

    const newResolution = aiResponse.response.text();

    // Store new resolution for future use
    const resolutionEntry = { issue, resolution: newResolution };
    resolutions.push(resolutionEntry);
    fs.writeFileSync(RESOLUTION_FILE, JSON.stringify(resolutions, null, 2), "utf8");

    console.log("New resolution saved:", newResolution);
    return newResolution;
  } catch (error) {
    console.error("❌ Error generating resolution:", error);
    return "Error fetching AI resolution.";
  }
}
