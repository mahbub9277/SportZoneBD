CREATE TYPE "ChannelReactionType" AS ENUM ('LIKE', 'DISLIKE');

CREATE TABLE "ChannelReaction" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "type" "ChannelReactionType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelReaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelReaction_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChannelReaction_userId_channelId_key" ON "ChannelReaction"("userId", "channelId");
CREATE INDEX "ChannelReaction_channelId_type_idx" ON "ChannelReaction"("channelId", "type");
