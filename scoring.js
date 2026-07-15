const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  const idx = Math.floor((p / 100) * (sortedArr.length - 1));
  return sortedArr[idx];
}

async function getReliability(aspId) {
  const asp = await prisma.asp.findUnique({ where: { id: aspId } });
  if (!asp) return null;

  const now = new Date();
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const pings24h = await prisma.ping.findMany({
    where: { aspId, timestamp: { gte: since24h } },
  });
  const pings7d = await prisma.ping.findMany({
    where: { aspId, timestamp: { gte: since7d } },
  });

  const openIncidents = await prisma.incident.count({ where: { aspId } });

  const uptime = (pings) =>
    pings.length === 0 ? null : pings.filter((p) => p.success).length / pings.length;

  const errorRate = (pings) =>
    pings.length === 0 ? null : pings.filter((p) => !p.success).length / pings.length;

  const latencies7d = pings7d
    .filter((p) => p.success && p.latencyMs != null)
    .map((p) => p.latencyMs)
    .sort((a, b) => a - b);

  const avgLatency =
    latencies7d.length > 0
      ? Math.round(latencies7d.reduce((a, b) => a + b, 0) / latencies7d.length)
      : null;

  const schemaDrift = pings7d.some((p) => p.schemaMatch === false);

  // Composite score, 0-100. Weighted: uptime matters most, then errors,
  // then latency (normalized against a 2000ms "acceptable" ceiling),
  // minus a flat penalty per open incident.
  let compositeScore = null;
  const u = uptime(pings7d);
  const e = errorRate(pings7d);
  if (u !== null) {
    const latencyScore = avgLatency != null ? Math.max(0, 1 - avgLatency / 2000) : 0.5;
    compositeScore = Math.round(
      (0.5 * u + 0.3 * (1 - (e ?? 0)) + 0.2 * latencyScore) * 100 -
        openIncidents * 5
    );
    compositeScore = Math.max(0, Math.min(100, compositeScore));
  }

  return {
    asp_id: asp.id,
    name: asp.name,
    category: asp.category,
    uptime_24h: uptime(pings24h),
    uptime_7d: u,
    avg_latency_ms: avgLatency,
    p95_latency_ms: percentile(latencies7d, 95),
    error_rate_7d: e,
    schema_drift_detected: schemaDrift,
    open_incidents: openIncidents,
    composite_score: compositeScore,
    sample_size_7d: pings7d.length,
    last_checked: pings7d[pings7d.length - 1]?.timestamp ?? null,
  };
}

async function compareAsps(category) {
  const where = category ? { category } : {};
  const asps = await prisma.asp.findMany({ where });
  const results = await Promise.all(asps.map((a) => getReliability(a.id)));
  return results
    .filter(Boolean)
    .sort((a, b) => (b.composite_score ?? -1) - (a.composite_score ?? -1));
}

module.exports = { getReliability, compareAsps };
