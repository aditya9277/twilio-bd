import fs from "fs";
import path from "path";
import twilio from "twilio";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const STORAGE_PATH = process.env.LOGS_PATH || path.join(__dirname, 'logs');
const CALLBACKS_FILE = path.join(STORAGE_PATH, 'scheduled_callbacks.json');
const PUBLIC_URL = process.env.PUBLIC_DEPLOYED_URL;

// ✅ Ensure the file exists
if (!fs.existsSync(CALLBACKS_FILE)) {
  fs.writeFileSync(CALLBACKS_FILE, JSON.stringify([]), "utf8");
}

// ✅ Function to determine call priority based on transcript & sentiment
const determinePriority = async (transcript, sentiment) => {
  const response = await model.generateContent(`
    You are an AI assistant helping a claims processing agent. 
    Based on this call transcript and customer sentiment, determine the priority of the callback:
    - High Priority: If urgent, frustrated customer, or repeated complaint.
    - Medium Priority: If customer is concerned but not urgent.
    - Low Priority: If it's a routine follow-up.
    
    Transcript: "${transcript}"
    Sentiment: "${sentiment}"
    
    Respond with only one word: High, Medium, or Low.
  `);

  return response.response.text().trim();
};

// ✅ Function to schedule a callback
const scheduleCallback = async (phoneNumber, transcript, sentiment) => {
  const priority = await determinePriority(transcript, sentiment);
  const callbackTime = calculateCallbackTime(priority);

  const newCallback = {
    phoneNumber,
    priority,
    callbackTime,
    status: "scheduled",
  };

  // ✅ Read existing callbacks
  const existingCallbacks = JSON.parse(fs.readFileSync(CALLBACKS_FILE, "utf8"));
  existingCallbacks.push(newCallback);

  // ✅ Save updated callbacks
  fs.writeFileSync(CALLBACKS_FILE, JSON.stringify(existingCallbacks, null, 2), "utf8");

  console.log(`📅 Callback scheduled for ${phoneNumber} at ${callbackTime} | Priority: ${priority}`);
};

// ✅ Function to determine callback timing based on priority
const calculateCallbackTime = (priority) => {
  const now = new Date();
  if (priority === "High") return new Date(now.getTime() + 10 * 60000); // 10 min
  if (priority === "Medium") return new Date(now.getTime() + 30 * 60000); // 30 min
  if (priority === "Low") return new Date(now.getTime() + 60 * 60000); // 30 min
  return new Date(now.getTime() + 60 * 60000); // 1 hour
};

// ✅ Function to check and trigger callbacks
const checkAndTriggerCallbacks = () => {
  const callbacks = JSON.parse(fs.readFileSync(CALLBACKS_FILE, "utf8"));
  const now = new Date();

  callbacks.forEach(async (callback) => {
    if (new Date(callback.callbackTime) <= now && callback.status === "scheduled") {
      console.log(`☎️ Triggering callback for ${callback.phoneNumber}`);
      // ✅ Mark callback as completed
      callback.status = "completed";
      await twilioClient.calls.create({
        url: `${process.env.PUBLIC_DEPLOYED_URL}/twiml`, // Use a separate TwiML for callbacks
        to: callback.phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER,
      });
  
    }
  });

  // ✅ Save updated callback statuses
  fs.writeFileSync(CALLBACKS_FILE, JSON.stringify(callbacks, null, 2), "utf8");
};

// ✅ Periodically check for callbacks (every minute)
setInterval(checkAndTriggerCallbacks, 60 * 1000);

export { scheduleCallback };
