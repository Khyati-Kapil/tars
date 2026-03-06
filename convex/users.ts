import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

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

export const upsertFromClerk = mutation({
  args: {
    name: v.string(),
    imageUrl: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        imageUrl: args.imageUrl,
        email: args.email,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      clerkId: identity.subject,
      name: args.name,
      imageUrl: args.imageUrl,
      email: args.email,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const searchUsers = query({
  args: {
    search: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await getCurrentUser(ctx);
    if (!currentUser) {
      return [];
    }

    const search = args.search.trim().toLowerCase();
    const users = await ctx.db.query("users").collect();

    const activeThreshold = Date.now() - 30_000;
    const presence = await ctx.db.query("presence").collect();
    const onlineByUserId = new Map(
      presence.map((entry) => [entry.userId, entry.lastSeenAt > activeThreshold]),
    );

    return users
      .filter((user) => user._id !== currentUser._id)
      .filter((user) => {
        if (!search) return true;
        return user.name.toLowerCase().includes(search);
      })
      .map((user) => ({
        _id: user._id,
        name: user.name,
        imageUrl: user.imageUrl,
        email: user.email,
        isOnline: onlineByUserId.get(user._id) ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const currentUser = await getCurrentUser(ctx);
    if (!currentUser) {
      return null;
    }

    return {
      _id: currentUser._id,
      name: currentUser.name,
      imageUrl: currentUser.imageUrl,
      email: currentUser.email,
    };
  },
});
