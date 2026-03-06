// @ts-nocheck
import { mutation } from "./_generated/server";
import { v } from "convex/values";

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

export const setTyping = mutation({
  args: {
    conversationId: v.id("conversations"),
    isTyping: v.boolean(),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUser(ctx);
    if (!me) {
      throw new Error("Unauthorized");
    }

    const existing = await ctx.db
      .query("typingStates")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", args.conversationId).eq("userId", me._id),
      )
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        isTyping: args.isTyping,
        updatedAt: now,
      });
      return;
    }

    await ctx.db.insert("typingStates", {
      conversationId: args.conversationId,
      userId: me._id,
      isTyping: args.isTyping,
      updatedAt: now,
    });
  },
});