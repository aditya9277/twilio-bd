import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function generateClaimDocument(phoneNumber, storagePath, callDate) {
  try {
    const transcriptPath = path.join(storagePath, `transcript_${phoneNumber}.txt`);
    const notesPath = path.join(storagePath, `agent_notes_${phoneNumber}.txt`);
    const claimDocPath = path.join(storagePath, `claim_doc_${phoneNumber}.pdf`);

    let transcriptText = "Transcript not available.";
    let agentNotes = "No agent notes provided.";

    // ✅ Read Call Transcript
    if (fs.existsSync(transcriptPath)) {
      transcriptText = fs.readFileSync(transcriptPath, "utf8");
    }

    // ✅ Read Agent Notes (Optional)
    if (fs.existsSync(notesPath)) {
      agentNotes = fs.readFileSync(notesPath, "utf8");
    }

    // ✅ 1️⃣ Generate AI-Powered Claim Document
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      You are an AI expert in customer service automation. Based on the provided **call transcript** and **agent notes**, 
      generate a **formal claim resolution document** that a **BPO call center agent** would submit. 
      Ensure it follows **professional structure**, includes **proper formatting**, and **summarizes the key details accurately**.

      **Include these details:**
      - **Customer Phone Number:** ${phoneNumber}
      - **Call Date:** ${callDate}
      - **Summary of the issue** (based on transcript)
      - **Steps taken by the agent**
      - **Resolution details or next steps**
      - **Formal closing statement**

      **Transcript:**  
      ${transcriptText}

      **Agent Notes:**  
      ${agentNotes}

      ✅ Ensure clarity, professionalism, and proper business tone. Format it in sections.
      
    `;

    const aiResponse = await model.generateContent(prompt);
    const claimContent = aiResponse.response.text();

    console.log("📄 AI-Generated Claim Document:\n", claimContent);

    // ✅ 2️⃣ Generate PDF from AI Claim Document
    const doc = new PDFDocument({ margin: 50 });

    const writeStream = fs.createWriteStream(claimDocPath);
    doc.pipe(writeStream);

    // ✅ **Header: Proper Encoding & Formatting**
    doc.font("Helvetica-Bold").fontSize(16).text("Claim Resolution Document", { align: "center" });
    doc.moveDown();

    doc.font("Helvetica").fontSize(12).text(`Customer Phone Number: ${phoneNumber}`);
    doc.text(`Call Date: ${callDate}`);
    doc.moveDown();

    // ✅ **Proper Section Headers**
    doc.font("Helvetica-Bold").text("AI-Generated Claim Document", { underline: true });
    doc.moveDown();

    // ✅ **Process AI Content Line-by-Line (For Formatting)**
    const lines = claimContent.split("\n");
    lines.forEach((line) => {
      if (line.startsWith("**") && line.endsWith("**")) {
        doc.moveDown().font("Helvetica-Bold").text(line.replace(/\*\*/g, "").trim());
      } else {
        doc.font("Helvetica").fontSize(10).text(line.trim(), { align: "left", lineGap: 5 });
      }
    });
    doc.end();

    console.log(`📄 Claim Document Saved: ${claimDocPath}`);

    return claimDocPath;

  } catch (error) {
    console.error("❌ Claim Document Generation Failed:", error);
  }
}
