import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    imageUrl: v.string(),
    email: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .searchIndex("search_name", {
      searchField: "name",
      filterFields: [],
    }),

  conversations: defineTable({
    isGroup: v.boolean(),
    name: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_created_by", ["createdBy"]),

  directConversations: defineTable({
    userOne: v.id("users"),
    userTwo: v.id("users"),
    conversationId: v.id("conversations"),
  }).index("by_pair", ["userOne", "userTwo"]),

  conversationMembers: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    lastReadAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user", ["userId"])
    .index("by_conversation_user", ["conversationId", "userId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    body: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deleted: v.boolean(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_sender", ["senderId"]),

  messageReactions: defineTable({
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
    createdAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_user_emoji", ["messageId", "userId", "emoji"]),

  typingStates: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    isTyping: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_user", ["conversationId", "userId"]),

  presence: defineTable({
    userId: v.id("users"),
    lastSeenAt: v.number(),
  }).index("by_user", ["userId"]),
});
