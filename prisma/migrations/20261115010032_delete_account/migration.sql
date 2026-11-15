-- Remove rows left behind by users that no longer exist, so the new foreign keys can be added.
DELETE FROM "UserArtist" WHERE "userId" NOT IN (SELECT "id" FROM "user");
DELETE FROM "UserSettings" WHERE "userId" NOT IN (SELECT "id" FROM "user");
DELETE FROM "SyncRun" WHERE "userId" IS NOT NULL AND "userId" NOT IN (SELECT "id" FROM "user");

-- DropForeignKey
ALTER TABLE "SuggestionReply" DROP CONSTRAINT "SuggestionReply_authorId_fkey";

-- AlterTable
ALTER TABLE "SuggestionReply" ALTER COLUMN "authorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "UserArtist" ADD CONSTRAINT "UserArtist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionReply" ADD CONSTRAINT "SuggestionReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
