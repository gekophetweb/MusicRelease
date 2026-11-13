-- Suggestion threads: five statuses, attention flags, replies.
-- Hand-edited so existing suggestions keep their data: doneAt is renamed (not dropped) and statuses are mapped.

-- AlterTable
ALTER TABLE "Suggestion" RENAME COLUMN "doneAt" TO "closedAt";
ALTER TABLE "Suggestion"
ADD COLUMN     "awaitingAdmin" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "awaitingUser" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "status" SET DEFAULT 'new';

-- Existing data: open → new (still needs the admin), done stays done (nothing to look at).
UPDATE "Suggestion" SET "status" = 'new' WHERE "status" = 'open';
UPDATE "Suggestion" SET "awaitingAdmin" = false WHERE "status" = 'done';

-- CreateTable
CREATE TABLE "SuggestionReply" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuggestionReply_suggestionId_createdAt_idx" ON "SuggestionReply"("suggestionId", "createdAt");

-- CreateIndex
CREATE INDEX "SuggestionReply_authorId_createdAt_idx" ON "SuggestionReply"("authorId", "createdAt");

-- AddForeignKey
ALTER TABLE "SuggestionReply" ADD CONSTRAINT "SuggestionReply_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "Suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionReply" ADD CONSTRAINT "SuggestionReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
