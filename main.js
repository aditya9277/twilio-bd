import express from "express";
import { Server } from "socket.io";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import speech from "@google-cloud/speech";
import dotenv from "dotenv";
import twilio from "twilio";
import cors from "cors";
import path from "path";
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { analyzeSentiment } from "./sentimentAnalyzer.js"; 
import { generateClaimDocument } from "./generateClaimDocument.js";
import { scheduleCallback } from "./callbackScheduler.js";
import { fetchKnowledgeResponse } from "./knowledgeBase.js";
import { generateCallSummary } from "./generateCallSummary.js";
import { getResolution } from "./resolutionGenerator.js";
import { analyzeCustomerBehavior } from "./FraudDetection.js";
import { triggerEscalation } from "./triggerEscalation.js";
let sentimentTimeout = null; 

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

//here we go
const PUBLIC_URL = process.env.PUBLIC_DEPLOYED_URL;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_PATH = process.env.LOGS_PATH || path.join(__dirname, "logs");
const CALLBACKS_FILE = path.join(STORAGE_PATH, "scheduled_callbacks.json");
const LIVE_TRANSCRIPT_FILE = path.join(STORAGE_PATH, "live_transcript.txt");
const activeCalls = {}; 
let transcriptBuffer = ""; // Stores accumulated speech
let geminiTimeout = null; // Holds the timeout reference
let callActive=true;
let wholetranscript="";
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// WebSocket Server for Twilio Live Audio (Using `<Start><Stream>`)
const wsServer = new WebSocketServer({ server });

wsServer.on("connection", (ws) => {
  console.log("Twilio Media Stream Connected (Receiving Live Audio)");
  //step 1 to get phone number
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.event === "start" && data.start.callSid) {
        const callSid = data.start.callSid;
        if (activeCalls[callSid]) {
          ws.callData = activeCalls[callSid]; // Store Call Data in WebSocket Instance
          console.log("📞 Active Call Detected:", ws.callData);
        }
      }
    } catch (error) {
      console.error("❌ WebSocket Message Error:", error);
    }
  });
  callActive = true; 
  const googleCredsPath = "/home/site/wwwroot/googlecreds/circular-truth-450110-n4-971bb24ebd34.json"; 
    const googleCreds = JSON.parse(fs.readFileSync(googleCredsPath, "utf8"));
    const speechClient = new speech.SpeechClient({
      credentials: googleCreds,
  });

  // Configure Google Speech-to-Text Streaming (Continuous Transcription)
  const request = {
    config: {
      encoding: "MULAW", // Twilio streams audio in MULAW format
      sampleRateHertz: 8000, // Twilio audio is 8kHz
      languageCode: "en-US", // Primary language
      alternativeLanguageCodes: ["en-IN"], // Add Hindi as an alternative language
    },
    interimResults: true, // Get live partial results
  };

  const recognizeStream = speechClient
    .streamingRecognize(request)
    .on("data", (data) => {
      if (data.results[0]?.isFinal) {
        const twiml = new twilio.twiml.VoiceResponse();
        const transcript = data.results[0]?.alternatives[0]?.transcript;
        console.log("🎤 Live Transcript:", transcript);

        //step2 for filewith phown number
        const phoneNumber = ws.callData ? ws.callData.phoneNumber : "unknown";
  
        // Define Call-Specific File Paths
        const transcriptFile = path.join(STORAGE_PATH, `transcript_${phoneNumber}.txt`);
        const suggestionsFile = path.join(STORAGE_PATH, `suggestions_${phoneNumber}.txt`);
        const sentimentFile = path.join(STORAGE_PATH, `sentiment_${phoneNumber}.txt`);
        // Save transcript in real-time
        fs.appendFileSync(transcriptFile, transcript + "\n", "utf8");
        fs.writeFileSync(LIVE_TRANSCRIPT_FILE, transcript, "utf8");
        
        transcriptBuffer += transcript + " ";
        wholetranscript+=transcript + " ";

        // Reset the timer if new speech comes in
        if (geminiTimeout) clearTimeout(geminiTimeout);

        // Wait 5-7 seconds before sending to Gemini
        geminiTimeout = setTimeout(() => {
            if(callActive){
                generateAISuggestions(transcriptBuffer.trim(), suggestionsFile); // Send accumulated transcript
                transcriptBuffer = ""; // Clear buffer after sending
            }
        }, 1200);
        // ⏳ Waits 6 seconds before sending

        //sentiment
        if (sentimentTimeout) clearTimeout(sentimentTimeout);

        sentimentTimeout = setTimeout(async () => {
          if (callActive) {
            const sentiment = await analyzeSentiment(transcriptBuffer.trim(),phoneNumber);
            console.log("🚀 Sentiment Analysis Result:", sentiment);
            // triggerEscalation(transcript,sentiment, phoneNumber);
            fs.writeFileSync(sentimentFile, `Sentiment: ${sentiment}\n`, "utf8");
          }
        }, 500);
      }
    })
    .on("error", (err) => console.error("❌ Speech API Error:", err));

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.event === "media" && data.media.payload) {
        const audioBuffer = Buffer.from(data.media.payload, "base64");
        recognizeStream.write(audioBuffer);
      }

      if (data.event === "stop") {
        console.log("❌ Twilio Call Ended - Stopping Gemini AI Processing");

        // Stop Gemini AI Processing
        callActive = false; // Mark call as inactive
        if (geminiTimeout) clearTimeout(geminiTimeout); // Cancel pending AI call

        // If any transcript is left, send it before stopping
        if (transcriptBuffer.trim()) {

            const phoneNumber = activeCalls[ws] ? activeCalls[ws].phoneNumber : "unknown";
            const suggestionsFile = `suggestions_${phoneNumber}.txt`;
            const sentimentFile = `sentiment_${phoneNumber}.txt`;
          
            generateAISuggestions(transcriptBuffer.trim(), suggestionsFile);
            analyzeSentiment(transcriptBuffer.trim(),phoneNumber).then(sentiment => {
              fs.writeFileSync(sentimentFile, `Sentiment: ${sentiment}\n`, "utf8");});
            transcriptBuffer = "";
        }
        recognizeStream.end();
        }
    } catch (error) { 
      console.error("❌ WebSocket Message Error:", error);
    }
  });

  ws.on("close", async () => {
    console.log("❌ Twilio Media Stream Disconnected");
    fs.writeFileSync(LIVE_TRANSCRIPT_FILE, "", "utf8"); // Clear transcript on disconnect
    const phoneNumber = ws.callData?.phoneNumber || "unknown"; 
    const callDate = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });// Get Call Date
    if(wholetranscript.trim()){
      const sentiment = await analyzeSentiment(wholetranscript.trim(),phoneNumber);
      scheduleCallback(phoneNumber, transcriptBuffer.trim(), sentiment);
    } 

    callActive = false;
    if (geminiTimeout) clearTimeout(geminiTimeout);

    if (transcriptBuffer.trim()) {

        const phoneNumber = activeCalls[ws] ? activeCalls[ws].phoneNumber : "unknown";
        const suggestionsFile = `suggestions_${phoneNumber}.txt`;
        const sentimentFile = `sentiment_${phoneNumber}.txt`;
      
        generateAISuggestions(transcriptBuffer.trim(), suggestionsFile);
        analyzeSentiment(transcriptBuffer.trim(),phoneNumber).then(sentiment => {
          fs.writeFileSync(sentimentFile, `Sentiment: ${sentiment}\n`, "utf8");});
  
        transcriptBuffer = "";
    }
    recognizeStream.end();
    //testing call summary 
    await generateCallSummary(phoneNumber);
    //testing my customer history
    await analyzeCustomerBehavior(phoneNumber);
    //testing pdf generator
    generateClaimDocument(phoneNumber, STORAGE_PATH, callDate).then((pdfPath) => {
      console.log(`📄 Claim Document Generated: ${pdfPath}`);
    });
  });
});

// Twilio Webhook to Start Media Streams (Uses `<Start><Stream>`)
app.post("/twiml", (req, res) => {
    const { To, CallSid } = req.body; // Get caller's phone number
  const phoneNumber = To ? To.replace("+", "") : "unknown"; // Remove '+'

  console.log("Twilio Webhook Hit: /twiml for", phoneNumber);

  // Store Call Details for WebSocket Connection
  activeCalls[CallSid] = { phoneNumber, callSid: CallSid };

  const twiml = new twilio.twiml.VoiceResponse();

  // Start Media Stream (Unidirectional)
  const start = twiml.start();
  start.stream({
    name: "LiveAudioStream",
    url: `wss://${PUBLIC_URL.replace('https://', '')}/live-audio`, // Replace with your WebSocket Server URL
  });

  twiml.say("Hello");
  twiml.pause({ length: 240 }); // Keeps call open for 240 seconds before repeating

  // Repeat the message to keep the conversation open
  // twiml.redirect("/twiml");
  console.log("TwiML Media Stream Response Sent:", twiml.toString());

  res.setHeader("Content-Type", "text/xml");
  res.send(twiml.toString());
});

// Send Real-Time Transcription to Gemini AI
async function generateAISuggestions(finalTranscript, fileName) {
    if (!finalTranscript) return; // Skip empty transcripts

    console.log("🤖 Sending to Gemini AI:", finalTranscript);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
    try {
      const aiResponse = await model.generateContent(`You are a farmer assistant, farmer will tell you his issues, you have to give best possible suggestions/resolutions, give only 2-3 suggestions, and each in a new line :\n${finalTranscript}`);
      const suggestions = aiResponse.response.text();
  
      console.log("🤖 AI Suggestions:", suggestions);
      fs.writeFileSync(fileName, suggestions + "\n", "utf8");
    } catch (error) {
      console.error("❌ Gemini AI Error:", error);
    }
}
// Like you are a helper to the call center agent, you have to aid them,you will be getting the live call transcript, and you have to give suggestions that could help agent in processing the customer easily and fast without error, if from the transcript you dont find on which you can give suggestion, just give general suggestions, dont give lame responses, and dont give many suggestions, give only 2-3 suggestions, and each in a new line

// API to Initiate a Call from Web
app.post("/call", async (req, res) => {
  try {
    console.log("Received Call Request:", req.body);
    const { to } = req.body;
    if (!to) {
      console.error("❌ Missing 'to' phone number");
      return res.status(400).json({ error: "Phone number is required" });
    }

    const call = await twilioClient.calls.create({
      url: `${process.env.PUBLIC_DEPLOYED_URL}/twiml`, // Replace with your Ngrok URL
      to: to,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    console.log("Call initiated:", call.sid);
    res.json({ success: true, callSid: call.sid });
  } catch (error) {
    console.error("❌ Twilio Call Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Define Path to Logs


// Ensure Logs Directory Exists
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH);
}

// Serve TXT Files via Express Static
app.use("/logs", express.static(STORAGE_PATH));

// API to Fetch Specific TXT File Based on Type (transcript, sentiment, etc.)
app.get("/logs/:type/:phoneNumber", (req, res) => {
  const { type, phoneNumber } = req.params;
  const fileExtension = type === "claim_doc" ? ".pdf" : ".txt";
  const filePath = path.join(STORAGE_PATH, `${type}_${phoneNumber}${fileExtension}`);

  // console.log("📂 Fetching file:", filePath);

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    // console.log("❌ File Not Found:", filePath);
    res.status(404).json({ error: "File not found" });
  }
});

app.get("/callbacks", (req, res) => {
  const callbacks = JSON.parse(fs.readFileSync(CALLBACKS_FILE, "utf8"));
  res.json(callbacks);
});

// API to fetch AI-powered knowledge base suggestions
// API for real-time suggestions (fetches from local DB only)
app.get("/knowledge-base/search", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "Query parameter is required" });

  console.log("🔎 Searching Knowledge Base:", query);

  const response = await fetchKnowledgeResponse(query, false);
  res.json(response);
});

// API for AI-powered answers (calls Gemini if no answer exists)
app.get("/knowledge-base/query", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "Query parameter is required" });

  console.log("🤖 Fetching AI-powered answer for:", query);

  const response = await fetchKnowledgeResponse(query, true);
  res.json(response);
});

// API to Fetch All Call Summaries
app.get("/logs/call-history", (req, res) => {
  const files = fs.readdirSync(STORAGE_PATH);
  const summaries = files
    .filter((file) => file.startsWith("call_summary_"))
    .map((file) => {
      return {
        phoneNumber: file.replace("call_summary_", "").replace(".txt", ""),
        filePath: `/logs/${file}`,
      };
    });

  res.json(summaries);
});

app.get("/logs/live-resolution", async (req, res) => {
  try {
    const transcript = fs.readFileSync(LIVE_TRANSCRIPT_FILE, "utf8");

    if (!transcript.trim()) {
      return res.json({ resolution: "Waiting for live call data..." });
    }

    const resolution = await getResolution(transcript);
    res.json({ resolution });
  } catch (error) {
    console.error("❌ Error fetching live resolution:", error);
    res.status(500).json({ error: "Could not fetch AI resolution" });
  }
});

app.get("/logs/claim-documents", (req, res) => {
  try {
    const files = fs.readdirSync(STORAGE_PATH);
    const claimDocs = files
      .filter((file) => file.startsWith("claim_doc_") && file.endsWith(".pdf"))
      .map((file) => ({
        phoneNumber: file.split("_")[2].replace(".pdf", ""),
        filePath: `/logs/claim_doc/${file.split("_")[2].replace(".pdf", "")}`,
      }));

    res.json(claimDocs);
  } catch (error) {
    console.error("Error fetching claim documents:", error);
    res.status(500).json({ error: "Failed to fetch claim documents" });
  }
});

//auto escalation
// app.get("/logs/escalations/:phoneNumber", (req, res) => {
//   const { phoneNumber } = req.params;
//   const escalationFile = path.join(STORAGE_PATH, `escalation_${phoneNumber}.txt`);

//   if (fs.existsSync(escalationFile)) {
//     const escalations = fs.readFileSync(escalationFile, "utf8")
//       .split("\n")
//       .filter(Boolean)
//       .map((line) => JSON.parse(line));
//     res.json(escalations);
//   } else {
//     res.json([]);
//   }
// });

app.get("/logs/escalations/:phoneNumber", async (req, res) => {
  const { phoneNumber } = req.params;
  const fileUrl = `https://twilio-ai-backend-gegfdfd9gnf2g9hg.southindia-01.azurewebsites.net/logs/escalation_${phoneNumber}.txt`;

  try {
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error("Failed to fetch file");

    const text = await response.text();
    const escalations = text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line); // Parse JSON safely
        } catch (error) {
          console.error("❌ JSON Parse Error:", line, error);
          return null; // Ignore invalid JSON
        }
      })
      .filter(Boolean);

    res.json(escalations);
  } catch (error) {
    console.error("❌ Error fetching escalation file:", error);
    res.status(500).json({ error: "Error fetching escalation file" });
  }
});

// 5️⃣ Start Backend
const port = process.env.PORT || 5000;
server.listen(port, () => console.log("🚀 Server running on port 5000"));

