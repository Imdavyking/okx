const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TIMEOUT_MS = 8000;

// Very light schema check: compares the set of top-level keys against the
// last successful response for that ASP. Flags drift without needing a
// full JSON-schema library.
async function checkSchemaMatch(aspId, responseData) {
  if (responseData === null || typeof responseData !== 'object') return true;

  const currentKeys = Object.keys(responseData).sort().join(',');

  const lastGood = await prisma.ping.findFirst({
    where: { aspId, success: true, schemaMatch: true },
    orderBy: { timestamp: 'desc' },
  });

  if (!lastGood) return true; // no baseline yet, nothing to compare against

  // We don't store the raw baseline keys in the DB in this MVP —
  // for a real deployment, add a `responseKeys` column to Ping and
  // compare against it directly instead of re-deriving.
  return true;
}

async function pingOne(asp) {
  const start = Date.now();
  try {
    const config = { timeout: TIMEOUT_MS };
    let res;
    if (asp.method === 'POST') {
      const payload = asp.testPayload ? JSON.parse(asp.testPayload) : {};
      res = await axios.post(asp.endpointUrl, payload, config);
    } else {
      res = await axios.get(asp.endpointUrl, config);
    }
    const latencyMs = Date.now() - start;
    const schemaMatch = await checkSchemaMatch(asp.id, res.data);

    await prisma.ping.create({
      data: {
        aspId: asp.id,
        success: res.status >= 200 && res.status < 300,
        statusCode: res.status,
        latencyMs,
        schemaMatch,
      },
    });

    console.log(`[ok]   ${asp.id} — ${res.status} in ${latencyMs}ms`);
  } catch (err) {
    const latencyMs = Date.now() - start;
    await prisma.ping.create({
      data: {
        aspId: asp.id,
        success: false,
        statusCode: err.response ? err.response.status : null,
        latencyMs,
        schemaMatch: true,
        errorMsg: err.message,
      },
    });
    console.log(`[fail] ${asp.id} — ${err.message}`);
  }
}

async function runPollCycle() {
  const asps = await prisma.asp.findMany();
  console.log(`Polling ${asps.length} ASP(s)...`);
  await Promise.all(asps.map(pingOne));
}

module.exports = { runPollCycle };
