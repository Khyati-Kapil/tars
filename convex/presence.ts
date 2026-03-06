import { mutation, type MutationCtx } from "./_generated/server";

async function getCurrentUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject) {
    return null;
  }

  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (!me) return;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeenAt: now });
      return;
    }

    await ctx.db.insert("presence", {
      userId: me._id,
      lastSeenAt: now,
    });
  },
});
