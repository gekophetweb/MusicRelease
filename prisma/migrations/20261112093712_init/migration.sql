-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('spotify', 'tidal');

-- CreateEnum
CREATE TYPE "ReleaseType" AS ENUM ('album', 'single');

-- CreateEnum
CREATE TYPE "DatePrecision" AS ENUM ('day', 'month', 'year');

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserArtist" (
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,

    CONSTRAINT "UserArtist_pkey" PRIMARY KEY ("userId","artistId")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ReleaseType" NOT NULL,
    "releaseDate" DATE NOT NULL,
    "datePrecision" "DatePrecision" NOT NULL,
    "coverUrl" TEXT,
    "url" TEXT NOT NULL,
    "totalTracks" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseArtist" (
    "releaseId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,

    CONSTRAINT "ReleaseArtist_pkey" PRIMARY KEY ("releaseId","artistId")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "digestEmail" TEXT,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "unsubscribeToken" TEXT NOT NULL,
    "lastDigestSentAt" TIMESTAMP(3),

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "userId" TEXT,
    "newReleases" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_provider_providerId_key" ON "Artist"("provider", "providerId");

-- CreateIndex
CREATE INDEX "Release_releaseDate_idx" ON "Release"("releaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Release_provider_providerId_key" ON "Release"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_unsubscribeToken_key" ON "UserSettings"("unsubscribeToken");

-- AddForeignKey
ALTER TABLE "UserArtist" ADD CONSTRAINT "UserArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseArtist" ADD CONSTRAINT "ReleaseArtist_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseArtist" ADD CONSTRAINT "ReleaseArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
