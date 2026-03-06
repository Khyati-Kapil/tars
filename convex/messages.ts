import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢"] as const;

type Ctx = QueryCtx | MutationCtx;

async function getCurrentUser(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    return null;
  }

  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

async function assertMember(
  ctx: Ctx,
  conversationId: Id<"conversations">,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("conversationMembers")
    .withIndex("by_conversation_user", (q) =>
      q.eq("conversationId", conversationId).eq("userId", userId),
    )
    .unique();

  if (!membership) {
    throw new Error("Not a conversation member");
  }

  return membership;
}

export const send = mutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    if (!me) {
      throw new Error("Unauthorized");
    }

    const text = args.body.trim();
    if (!text) {
      throw new Error("Message cannot be empty");
    }

    await assertMember(ctx, args.conversationId, me._id);

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      senderId: me._id,
      body: text,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    });

    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", args.conversationId).eq("userId", me._id),
      )
      .unique();

    if (membership) {
      await ctx.db.patch(membership._id, { lastReadAt: now });
    }

    return messageId;
  },
});

export const deleteOwnMessage = mutation({
  args: {
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    if (!me) {
      throw new Error("Unauthorized");
    }

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    if (message.senderId !== me._id) {
      throw new Error("You can only delete your own messages");
    }

    await ctx.db.patch(message._id, {
      deleted: true,
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const toggleReaction = mutation({
  args: {
    messageId: v.id("messages"),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    if (!me) {
      throw new Error("Unauthorized");
    }

    if (!ALLOWED_REACTIONS.includes(args.emoji as (typeof ALLOWED_REACTIONS)[number])) {
      throw new Error("Unsupported reaction");
    }

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    await assertMember(ctx, message.conversationId, me._id);

    const existing = await ctx.db
      .query("messageReactions")
      .withIndex("by_message_user_emoji", (q) =>
        q.eq("messageId", args.messageId).eq("userId", me._id).eq("emoji", args.emoji),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { active: false };
    }

    await ctx.db.insert("messageReactions", {
      messageId: args.messageId,
      userId: me._id,
      emoji: args.emoji,
      createdAt: Date.now(),
    });

    return { active: true };
  },
});

export const listByConversation = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    if (!me) {
      return null;
    }

    await assertMember(ctx, args.conversationId, me._id);

    const rows = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    rows.sort((a, b) => a.createdAt - b.createdAt);

    const memberRows = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    const userIds = [...new Set(memberRows.map((m) => m.userId))];
    const profiles = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const validProfiles = profiles.filter(
      (profile): profile is NonNullable<typeof profile> => profile !== null,
    );
    const userMap = new Map(
      validProfiles.map((profile) => [profile._id, profile]),
    );

    const typingRows = await ctx.db
      .query("typingStates")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
      .collect();

    const recentTyping = typingRows.find(
      (row) =>
        row.userId !== me._id && row.isTyping && Date.now() - row.updatedAt <= 2_000,
    );

    const typingUser = recentTyping ? userMap.get(recentTyping.userId) : null;

    const allReactions = await Promise.all(
      rows.map((message) =>
        ctx.db
          .query("messageReactions")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .collect(),
      ),
    );

    const reactionsByMessage = new Map(
      rows.map((message, index) => [message._id, allReactions[index]]),
    );

    return {
      currentUserId: me._id,
      typingUserName: typingUser?.name ?? null,
      messages: rows.map((msg) => {
        const sender = userMap.get(msg.senderId);
        const reactions = reactionsByMessage.get(msg._id) ?? [];
        const grouped = ALLOWED_REACTIONS.map((emoji) => {
          const matches = reactions.filter((reaction) => reaction.emoji === emoji);
          return {
            emoji,
            count: matches.length,
            reactedByMe: matches.some((reaction) => reaction.userId === me._id),
          };
        }).filter((entry) => entry.count > 0);

        return {
          _id: msg._id,
          body: msg.body,
          createdAt: msg.createdAt,
          deleted: msg.deleted,
          senderId: msg.senderId,
          senderName: sender?.name ?? "Unknown",
          senderImageUrl: sender?.imageUrl ?? "",
          isMine: msg.senderId === me._id,
          reactions: grouped,
        };
      }),
    };
  },
});
