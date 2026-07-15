require("dotenv").config();
const express = require("express");
const cron = require("node-cron");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");
const { getReliability, compareAsps } = require("./scoring");
const { runPollCycle } = require("./poller");

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const POLL_MINUTES = parseInt(process.env.POLL_INTERVAL_MINUTES || "10", 10);

// --- Health check (also used as AgentTrust's own self-monitored endpoint) ---
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "agenttrust",
    time: new Date().toISOString(),
  });
});

// --- Tool 1: check_reliability ---
// GET /check_reliability?asp_id=riskgate
app.get("/check_reliability", async (req, res) => {
  const { asp_id } = req.query;
  if (!asp_id) {
    return res.status(400).json({ error: "asp_id query param is required" });
  }
  const result = await getReliability(asp_id);
  if (!result) {
    return res.status(404).json({ error: `No ASP found with id "${asp_id}"` });
  }
  res.json(result);
});

// --- Tool 2: compare_asps ---
// GET /compare_asps?category=finance
app.get("/compare_asps", async (req, res) => {
  const { category } = req.query;
  const results = await compareAsps(category);
  res.json({ category: category || "all", ranked: results });
});

// --- Tool 3: report_incident ---
// POST /report_incident  { asp_id, description, evidence_url }
app.post("/report_incident", async (req, res) => {
  const { asp_id, description, evidence_url, reported_by } = req.body || {};
  if (!asp_id || !description) {
    return res
      .status(400)
      .json({ error: "asp_id and description are required" });
  }
  const asp = await prisma.asp.findUnique({ where: { id: asp_id } });
  if (!asp) {
    return res.status(404).json({ error: `No ASP found with id "${asp_id}"` });
  }
  const incident = await prisma.incident.create({
    data: {
      aspId: asp_id,
      description,
      evidenceUrl: evidence_url || null,
      reportedBy: reported_by || null,
    },
  });
  res.status(201).json({ status: "recorded", incident_id: incident.id });
});

// --- List tracked ASPs (helper endpoint, not one of the 3 core tools) ---
app.get("/asps", async (req, res) => {
  const asps = await prisma.asp.findMany();
  res.json(asps);
});

const VALID_CATEGORIES = ["finance", "software", "lifestyle", "art"];

// --- Self-serve registration: let any ASP add itself to be monitored ---
// POST /register_asp
// { id, name, category, endpoint_url, method?, test_payload? }
app.post("/register_asp", async (req, res) => {
  const { id, name, category, endpoint_url, method, test_payload } =
    req.body || {};

  // --- Basic required-field validation ---
  if (!id || !name || !category || !endpoint_url) {
    return res.status(400).json({
      error: "id, name, category, and endpoint_url are all required",
    });
  }

  // --- id format: keep it URL/query-string friendly ---
  if (!/^[a-z0-9][a-z0-9-_]{1,63}$/.test(id)) {
    return res.status(400).json({
      error:
        "id must be 2-64 chars, lowercase letters/numbers/hyphens/underscores only, and start with a letter or number",
    });
  }

  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: `category must be one of: ${VALID_CATEGORIES.join(", ")}`,
    });
  }

  const httpMethod = (method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(httpMethod)) {
    return res.status(400).json({ error: "method must be GET or POST" });
  }

  // --- endpoint_url must be a well-formed, public HTTPS URL ---
  let parsedUrl;
  try {
    parsedUrl = new URL(endpoint_url);
  } catch {
    return res.status(400).json({ error: "endpoint_url is not a valid URL" });
  }
  if (parsedUrl.protocol !== "https:") {
    return res.status(400).json({ error: "endpoint_url must use https://" });
  }
  const hostname = parsedUrl.hostname;
  const isLocalOrPrivate =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  if (isLocalOrPrivate) {
    return res.status(400).json({
      error: "endpoint_url must be a public address, not localhost/private IP",
    });
  }

  // --- Reject duplicates explicitly rather than silently overwriting ---
  const existing = await prisma.asp.findUnique({ where: { id } });
  if (existing) {
    return res.status(409).json({
      error: `An ASP with id "${id}" is already registered. Choose a different id.`,
    });
  }

  // --- Verify the endpoint is actually reachable before accepting it ---
  try {
    const testConfig = { timeout: 8000 };
    if (httpMethod === "POST") {
      const payload = test_payload ? JSON.parse(test_payload) : {};
      await axios.post(endpoint_url, payload, testConfig);
    } else {
      await axios.get(endpoint_url, testConfig);
    }
  } catch (err) {
    return res.status(400).json({
      error: `Could not reach endpoint_url during registration check: ${err.message}`,
    });
  }

  const asp = await prisma.asp.create({
    data: {
      id,
      name,
      category,
      endpointUrl: endpoint_url,
      method: httpMethod,
      testPayload: test_payload || null,
    },
  });

  res.status(201).json({
    status: "registered",
    asp_id: asp.id,
    note: "This ASP will be included starting with the next poll cycle.",
  });
});

app.listen(PORT, () => {
  console.log(`AgentTrust listening on port ${PORT}`);

  // Run once on boot, then on schedule.
  runPollCycle().catch((e) => console.error("Initial poll failed:", e));
  cron.schedule(`*/${POLL_MINUTES} * * * *`, () => {
    runPollCycle().catch((e) => console.error("Poll cycle failed:", e));
  });
});
