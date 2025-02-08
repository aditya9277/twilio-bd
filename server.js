import express from "express";
import { Server } from "socket.io";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import speech from "@google-cloud/speech";
import dotenv from "dotenv";
import twilio from "twilio";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { analyzeSentiment } from "./sentimentAnalyzer.js"; // ✅ Import Sentiment Analyzer


dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const transcriptFile = "/home/site/wwwroot/logs/transcript.txt";
const suggestionsFile = "/home/site/wwwroot/logs/suggestions.txt";
const PUBLIC_URL = process.env.PUBLIC_DEPLOYED_URL;
let transcriptBuffer = ""; // ✅ Stores accumulated speech
let geminiTimeout = null; // ✅ Holds the timeout reference
let callActive=true;
let sentimentTimeout = null; // ✅ Timer for delayed sentiment analysis

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ✅ 1️⃣ WebSocket Server for Twilio Live Audio (Using `<Start><Stream>`)
const wsServer = new WebSocketServer({ server });

wsServer.on("connection", (ws) => {
  console.log("✅ Twilio Media Stream Connected (Receiving Live Audio)");
  callActive = true; 
  const googleCredsPath = "/home/site/wwwroot/googlecreds/circular-truth-450110-n4-971bb24ebd34.json"; 
  const googleCreds = JSON.parse(fs.readFileSync(googleCredsPath, "utf8"));
  const speechClient = new speech.SpeechClient({
    credentials: googleCreds,
  });

  // ✅ Configure Google Speech-to-Text Streaming (Continuous Transcription)
  const request = {
    config: {
      encoding: "MULAW", // ✅ Twilio streams audio in MULAW format
      sampleRateHertz: 8000, // ✅ Twilio audio is 8kHz
      languageCode: "en-US",
    },
    interimResults: true, // ✅ Get live partial results
  };

  const recognizeStream = speechClient
    .streamingRecognize(request)
    .on("data", (data) => {
      if (data.results[0]?.isFinal) {

        const transcript = data.results[0]?.alternatives[0]?.transcript;
        console.log("🎤 Live Transcript:", transcript);

        // ✅ Save transcript in real-time
        fs.appendFileSync(transcriptFile, transcript + "\n", "utf8");
        
        transcriptBuffer += transcript + " ";

        // ✅ Reset the timer if new speech comes in
        if (geminiTimeout) clearTimeout(geminiTimeout);

        // ✅ Wait 5-7 seconds before sending to Gemini
        geminiTimeout = setTimeout(() => {
            if(callActive){
                generateAISuggestions(transcriptBuffer.trim()); // ✅ Send accumulated transcript
                transcriptBuffer = ""; // ✅ Clear buffer after sending
            }
        }, 4000);
        // ⏳ Waits 6 seconds before sending

        //sentiment
        if (sentimentTimeout) clearTimeout(sentimentTimeout);

        sentimentTimeout = setTimeout(async () => {
          if (callActive) {
            const sentiment = await analyzeSentiment(transcriptBuffer.trim());
            console.log("🚀 Sentiment Analysis Result:", sentiment);
          }
        }, 4000);
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

        // ✅ Stop Gemini AI Processing
        callActive = false; // ✅ Mark call as inactive
        if (geminiTimeout) clearTimeout(geminiTimeout); // ✅ Cancel pending AI call

        // ✅ If any transcript is left, send it before stopping
        if (transcriptBuffer.trim()) {
          generateAISuggestions(transcriptBuffer.trim());
          analyzeSentiment(transcriptBuffer.trim()); // ✅ Get sentiment on final transcript
          transcriptBuffer = "";
        }
        recognizeStream.end();
        }
    } catch (error) {
      console.error("❌ WebSocket Message Error:", error);
    }
  });

  ws.on("close", () => {
    console.log("❌ Twilio Media Stream Disconnected");

    callActive = false;
    if (geminiTimeout) clearTimeout(geminiTimeout);

    if (transcriptBuffer.trim()) {
      generateAISuggestions(transcriptBuffer.trim());
      analyzeSentiment(transcriptBuffer.trim()); // ✅ Get sentiment on final transcript
      transcriptBuffer = "";
    }
    recognizeStream.end();
  });
});

// ✅ 2️⃣ Twilio Webhook to Start Media Streams (Uses `<Start><Stream>`)
app.post("/twiml", (req, res) => {
  console.log("✅ Twilio Webhook Hit: /twiml");

  const twiml = new twilio.twiml.VoiceResponse();

  // ✅ Start Media Stream (Unidirectional)
  const start = twiml.start();
  start.stream({
    name: "LiveAudioStream",
    url: `wss://${PUBLIC_DEPLOYED_URL.replace('https://', '')}/live-audio`, // ✅ Replace with your WebSocket Server URL
  });

  twiml.say("Hello, it's Aditya, your AI assistant. I am now listening to you.");
  twiml.pause({ length: 30 }); // ✅ Keeps call open for 30 seconds before repeating

  // ✅ Repeat the message to keep the conversation open
  // twiml.redirect("/twiml");
  console.log("✅ TwiML Media Stream Response Sent:", twiml.toString());

  res.setHeader("Content-Type", "text/xml");
  res.send(twiml.toString());
});

// ✅ 3️⃣ Send Real-Time Transcription to Gemini AI
async function generateAISuggestions(finalTranscript) {
    if (!finalTranscript) return; // ✅ Skip empty transcripts

    console.log("🤖 Sending to Gemini AI:", finalTranscript);
  
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
    try {
      const aiResponse = await model.generateContent(`Provide agent assistance based on this call transcript:\n${finalTranscript}`);
      const suggestions = aiResponse.response.text();
  
      console.log("🤖 AI Suggestions:", suggestions);
      fs.appendFileSync(suggestionsFile, suggestions + "\n", "utf8");
    } catch (error) {
      console.error("❌ Gemini AI Error:", error);
    }
}

// ✅ 4️⃣ API to Initiate a Call from Web
app.post("/call", async (req, res) => {
  try {
    console.log("Received Call Request:", req.body);
    const { to } = req.body;
    if (!to) {
      console.error("❌ Missing 'to' phone number");
      return res.status(400).json({ error: "Phone number is required" });
    }

    const call = await twilioClient.calls.create({
      url: `${process.env.PUBLIC_DEPLOYED_URL}/twiml`, // ✅ Replace with your Ngrok URL
      to: to,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    console.log("✅ Call initiated:", call.sid);
    res.json({ success: true, callSid: call.sid });
  } catch (error) {
    console.error("❌ Twilio Call Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});
const port = process.env.PORT || 4040;
// ✅ 5️⃣ Start Backend
server.listen(port, () => console.log("🚀 Server running on port 5000"));
