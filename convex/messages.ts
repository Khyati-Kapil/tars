// @ts-nocheck
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

async function getCurrentUser(ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    return null;
  }

  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

async function assertMember(ctx, conversationId, userId) {
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
    const userMap = new Map(
      profiles.filter(Boolean).map((user) => [user._id, user]),
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

    return {
      currentUserId: me._id,
      typingUserName: typingUser?.name ?? null,
      messages: rows.map((msg) => {
        const sender = userMap.get(msg.senderId);
        return {
          _id: msg._id,
          body: msg.body,
          createdAt: msg.createdAt,
          deleted: msg.deleted,
          senderId: msg.senderId,
          senderName: sender?.name ?? "Unknown",
          senderImageUrl: sender?.imageUrl ?? "",
          isMine: msg.senderId === me._id,
        };
      }),
    };
  },
});