const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Add/edit the ASPs you want to monitor here.
// endpointUrl should be a lightweight, cheap-to-call route on each ASP
// (ideally a free/read-only endpoint, not one that costs the target money to serve).
const ASPS = [
  {
    id: 'agenttrust-self',
    name: 'AgentTrust (self-check)',
    category: 'software',
    endpointUrl: 'http://localhost:3000/health',
    method: 'GET',
  },
  // Example placeholders — replace with real public ASP endpoints you track.
  // {
  //   id: 'riskgate',
  //   name: 'RiskGate Token Risk Report',
  //   category: 'finance',
  //   endpointUrl: 'https://riskgate.example.com/health',
  //   method: 'GET',
  // },
];

async function main() {
  for (const asp of ASPS) {
    await prisma.asp.upsert({
      where: { id: asp.id },
      update: asp,
      create: asp,
    });
  }
  console.log(`Seeded ${ASPS.length} ASP(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
