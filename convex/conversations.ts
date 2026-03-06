import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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

function sortPair(idOne: Id<"users">, idTwo: Id<"users">) {
  return String(idOne) < String(idTwo) ? [idOne, idTwo] : [idTwo, idOne];
}

export const openDirectConversation = mutation({
  args: {
    otherUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    if (!me) {
      throw new Error("Unauthorized");
    }

    if (me._id === args.otherUserId) {
      throw new Error("Cannot create conversation with yourself");
    }

    const [userOne, userTwo] = sortPair(me._id, args.otherUserId);
    const existingPair = await ctx.db
      .query("directConversations")
      .withIndex("by_pair", (q) => q.eq("userOne", userOne).eq("userTwo", userTwo))
      .unique();

    if (existingPair) {
      return existingPair.conversationId;
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      isGroup: false,
      createdBy: me._id,
      createdAt: now,
    });

    await ctx.db.insert("conversationMembers", {
      conversationId,
      userId: me._id,
      lastReadAt: now,
    });

    await ctx.db.insert("conversationMembers", {
      conversationId,
      userId: args.otherUserId,
      lastReadAt: 0,
    });

    await ctx.db.insert("directConversations", {
      userOne,
      userTwo,
      conversationId,
    });

    return conversationId;
  },
});

export const markConversationRead = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    if (!me) {
      throw new Error("Unauthorized");
    }

    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", args.conversationId).eq("userId", me._id),
      )
      .unique();

    if (!membership) {
      throw new Error("Not a conversation member");
    }

    await ctx.db.patch(membership._id, {
      lastReadAt: Date.now(),
    });
  },
});

export const createGroupConversation = mutation({
  args: {
    name: v.string(),
    memberIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    if (!me) {
      throw new Error("Unauthorized");
    }

    const cleanName = args.name.trim();
    if (cleanName.length < 2) {
      throw new Error("Group name must be at least 2 characters");
    }

    const uniqueMembers = [...new Set(args.memberIds)].filter((id) => id !== me._id);
    if (uniqueMembers.length < 2) {
      throw new Error("Select at least two other members");
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      isGroup: true,
      name: cleanName,
      createdBy: me._id,
      createdAt: now,
    });

    await ctx.db.insert("conversationMembers", {
      conversationId,
      userId: me._id,
      lastReadAt: now,
    });

    for (const memberId of uniqueMembers) {
      await ctx.db.insert("conversationMembers", {
        conversationId,
        userId: memberId,
        lastReadAt: 0,
      });
    }

    return conversationId;
  },
});

export const listForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (!me) {
      return [];
    }

    const myMemberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    const activeThreshold = Date.now() - 30_000;
    const presence = await ctx.db.query("presence").collect();
    const onlineByUserId = new Map(
      presence.map((entry) => [entry.userId, entry.lastSeenAt > activeThreshold]),
    );

    const results = [];

    for (const membership of myMemberships) {
      const conversation = await ctx.db.get(membership.conversationId);
      if (!conversation) continue;

      const members = await ctx.db
        .query("conversationMembers")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", membership.conversationId),
        )
        .collect();

      const otherMembers = members.filter((m) => m.userId !== me._id);
      const otherProfiles = await Promise.all(otherMembers.map((m) => ctx.db.get(m.userId)));
      const validOthers = otherProfiles.filter(Boolean);

      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", membership.conversationId))
        .collect();

      messages.sort((a, b) => a.createdAt - b.createdAt);
      const latestMessage = messages[messages.length - 1] ?? null;

      const unreadCount = messages.filter(
        (msg) => msg.senderId !== me._id && msg.createdAt > membership.lastReadAt,
      ).length;

      const directTarget = validOthers[0] ?? null;
      const title = conversation.isGroup
        ? conversation.name ?? "Untitled Group"
        : directTarget?.name ?? "Unknown User";
      const imageUrl = conversation.isGroup
        ? ""
        : (directTarget?.imageUrl ?? "");

      results.push({
        _id: conversation._id,
        isGroup: conversation.isGroup,
        title,
        imageUrl,
        memberCount: members.length,
        unreadCount,
        latestMessage: latestMessage
          ? {
              body: latestMessage.deleted ? "This message was deleted" : latestMessage.body,
              createdAt: latestMessage.createdAt,
              deleted: latestMessage.deleted,
            }
          : null,
        isOtherOnline: directTarget ? (onlineByUserId.get(directTarget._id) ?? false) : false,
      });
    }

    return results.sort((a, b) => {
      const aTime = a.latestMessage?.createdAt ?? 0;
      const bTime = b.latestMessage?.createdAt ?? 0;
      return bTime - aTime;
    });
  },
});
