// services/elevenlabs.js
const { createOrUpdateContact, addNote } = require("./ghl");
const { extractAiData } = require("./ai");
const winston = require("winston");

// ----------------------
// Logging Setup
// ----------------------
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaString = Object.keys(meta).length
        ? JSON.stringify(meta, null, 2)
        : "";
      return `[${timestamp}] [${level.toUpperCase()}]: ${message} ${metaString}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

// ----------------------
// Approved ElevenLabs Agent (Wiggins)
// ----------------------
const ALLOWED_AGENT_ID = "agent_1901k5390f3je1s8pqqhqayr0ab5";

// ----------------------
// Phone Normalizer
// ----------------------
function normalizePhone(phone) {
  if (!phone) return null;

  let digits = phone.replace(/\D/g, "");

  // 10-digit US number → prepend country code
  if (digits.length === 10) {
    digits = "1" + digits;
  }

  return "+" + digits;
}

// ----------------------
// ElevenLabs Webhook Handler
// ----------------------
async function elevenWebhookHandler(req, res) {
  try {
    const body = req.body || {};
    logger.info("Incoming ElevenLabs Webhook Body:", body);

    const data = body?.data || {};

    // -------------------------------
    // AGENT FILTER (Wiggins Only)
    // -------------------------------
    const agentId =
      data?.agent?.agent_id ||
      data?.agent_id ||
      data?.conversation_initiation_client_data?.dynamic_variables?.system__current_agent_id ||
      null;

    if (agentId !== ALLOWED_AGENT_ID) {
      logger.warn("❌ Ignoring webhook from different agent:", { agentId });
      return res.status(200).send("Ignored: Not Wiggins agent");
    }

    logger.info("✔ Accepted webhook from Wiggins agent", { agentId });

    // -------------------------------
    // Caller Phone
    // -------------------------------
    const phoneRaw =
      data?.conversation_initiation_client_data?.dynamic_variables?.system__caller_id ||
      null;

    let phone = normalizePhone(phoneRaw);

    // -------------------------------
    // TEST vs PRODUCTION LOGIC
    // -------------------------------
    if (process.env.NODE_ENV === "production") {
      if (!phone) {
        logger.error("❌ PROD MODE: Missing caller_id");
        return res.status(400).send("Missing caller phone number (caller_id)");
      }
    } else {
      if (!phone) {
        logger.warn("⚠ TEST MODE: No caller_id → Using FAKE TEST NUMBER +15555550123");
        phone = "+15555550123";
      }
    }

    // -------------------------------
    // Call SID
    // -------------------------------
    const callSid =
      data?.conversation_initiation_client_data?.dynamic_variables?.system__call_sid ||
      null;

    // -------------------------------
    // Transcript Build
    // -------------------------------
    const transcriptArray = data?.transcript || [];
    const transcript = transcriptArray
      .map((t) => `${t.role.toUpperCase()}: ${t.message}`)
      .join("\n");

    // -------------------------------
    // Timestamps
    // -------------------------------
    const startTime = data?.conversation_initiation_client_data?.dynamic_variables?.system__date
      ? data.conversation_initiation_client_data.dynamic_variables.system__date
      : data?.metadata?.start_time_unix_secs
        ? new Date(data.metadata.start_time_unix_secs * 1000).toISOString()
        : "Unknown";

    const endTime = data?.metadata?.accepted_time_unix_secs
      ? new Date(data.metadata.accepted_time_unix_secs * 1000).toISOString()
      : "Unknown";

    logger.info("Extracted Caller Info", {
      phone,
      callSid,
      startTime,
      endTime,
    });

    // -------------------------------
    // AI Extraction
    // -------------------------------
    logger.info("Running AI extraction...");
    const ai = await extractAiData(transcript);
    logger.info("AI extracted data:", ai);

    // -------------------------------
    // Create / Update Contact
    // -------------------------------
    const contact = await createOrUpdateContact({
      firstName: ai?.firstName || "",
      lastName: ai?.lastName || "",
      email: ai?.email || "",
      company: ai?.companyName || ai?.businessName || "",
      phone,
    });

    const contactId =
      contact?.id ||
      contact?.contact?.id ||
      contact?.data?.id;

    if (!contactId) {
      logger.error("Failed to extract contact ID", { contact });
      return res.status(500).send("Could not determine contact ID");
    }

    logger.info("GHL Contact Created/Updated", { contactId });

    // -------------------------------
    // Save Notes
    // -------------------------------
    const callDetailsNote =
      `ElevenLabs Call Details\n` +
      `Caller: ${phone}\n` +
      `Call SID: ${callSid}\n` +
      `Start: ${startTime}\n` +
      `End: ${endTime}`;
    await addNote(contactId, callDetailsNote);

    const transcriptNote = `Full Call Transcript\n\n${transcript}`;
    await addNote(contactId, transcriptNote);

    const aiNote =
      `AI Summary\n` +
      `First Name: ${ai?.firstName}\n` +
      `Last Name: ${ai?.lastName}\n` +
      `Email: ${ai?.email}\n` +
      `Company: ${ai?.companyName || ai?.businessName}\n\n` +
      `Summary:\n${ai?.summary}`;
    await addNote(contactId, aiNote);

    logger.info("All Notes Saved", { contactId });

    return res.status(200).send("Webhook processed successfully");
  } catch (err) {
    logger.error("Error processing ElevenLabs webhook", {
      error: err?.response?.data || err.message,
      stack: err.stack,
    });

    return res.status(500).send("Error processing webhook");
  }
}

module.exports = { elevenWebhookHandler };
