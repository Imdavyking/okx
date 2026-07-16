-- CreateTable
CREATE TABLE "Asp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "testPayload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Ping" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "aspId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" INTEGER,
    "schemaMatch" BOOLEAN NOT NULL DEFAULT true,
    "errorMsg" TEXT,
    CONSTRAINT "Ping_aspId_fkey" FOREIGN KEY ("aspId") REFERENCES "Asp" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "aspId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "reportedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Incident_aspId_fkey" FOREIGN KEY ("aspId") REFERENCES "Asp" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Ping_aspId_timestamp_idx" ON "Ping"("aspId", "timestamp");
