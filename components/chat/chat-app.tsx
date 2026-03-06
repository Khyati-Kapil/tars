"use client";

import {
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import clsx from "clsx";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢"] as const;

type Me = {
  _id: string;
  name: string;
  imageUrl: string;
  email: string;
};

type UserSearchResult = {
  _id: string;
  name: string;
  imageUrl: string;
  email: string;
  isOnline: boolean;
};

type ConversationSummary = {
  _id: string;
  isGroup: boolean;
  title: string;
  imageUrl: string;
  memberCount: number;
  unreadCount: number;
  latestMessage: { body: string; createdAt: number; deleted: boolean } | null;
  isOtherOnline: boolean;
};

type ConversationMessage = {
  _id: string;
  body: string;
  createdAt: number;
  deleted: boolean;
  senderId: string;
  senderName: string;
  senderImageUrl: string;
  isMine: boolean;
  reactions: {
    emoji: string;
    count: number;
    reactedByMe: boolean;
  }[];
};

type MessagesData = {
  currentUserId: string;
  typingUserName: string | null;
  messages: ConversationMessage[];
};

function formatMessageTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const isSameYear = date.getFullYear() === now.getFullYear();
  const isSameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    isSameYear;

  if (isSameDay) {
    return format(date, "h:mm a");
  }

  if (isSameYear) {
    return format(date, "MMM d, h:mm a");
  }

  return format(date, "MMM d yyyy, h:mm a");
}

function Avatar({ name, imageUrl }: { name: string; imageUrl: string }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="h-9 w-9 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-300 text-sm font-semibold text-slate-700">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function ChatApp() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();

  const upsertProfile = useMutation(api.users.upsertFromClerk);
  const sendHeartbeat = useMutation(api.presence.heartbeat);
  const openDirectConversation = useMutation(api.conversations.openDirectConversation);
  const createGroupConversation = useMutation(api.conversations.createGroupConversation);
  const markConversationRead = useMutation(api.conversations.markConversationRead);
  const sendMessage = useMutation(api.messages.send);
  const setTyping = useMutation(api.typing.setTyping);
  const deleteOwnMessage = useMutation(api.messages.deleteOwnMessage);
  const toggleReaction = useMutation(api.messages.toggleReaction);

  const me = useQuery(api.users.me, {}) as Me | null | undefined;
  const conversations = useQuery(api.conversations.listForCurrentUser, {}) as
    | ConversationSummary[]
    | undefined;

  const [searchText, setSearchText] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [mobileMode, setMobileMode] = useState<"list" | "chat">("list");
  const [messageText, setMessageText] = useState("");
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [showGroupCreator, setShowGroupCreator] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const users = useQuery(api.users.searchUsers, {
    search: searchText,
  }) as UserSearchResult[] | undefined;
  const allUsers = useQuery(api.users.searchUsers, {
    search: "",
  }) as UserSearchResult[] | undefined;

  const activeConversationId =
    selectedConversationId ?? ((conversations?.[0]?._id as unknown as string | undefined) ?? null);

  const messagesData = useQuery(
    api.messages.listByConversation,
    activeConversationId ? { conversationId: activeConversationId as never } : "skip",
  ) as MessagesData | null | undefined;

  useEffect(() => {
    if (!user) return;

    const email = user.primaryEmailAddress?.emailAddress ?? "";
    if (!email) return;

    void upsertProfile({
      name: user.fullName ?? user.firstName ?? "Anonymous",
      imageUrl: user.imageUrl,
      email,
    });
  }, [upsertProfile, user]);

  useEffect(() => {
    if (!user) return;

    void sendHeartbeat({});

    const intervalId = setInterval(() => {
      void sendHeartbeat({});
    }, 15_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void sendHeartbeat({});
      }
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sendHeartbeat, user]);

  useEffect(() => {
    if (!activeConversationId) return;
    void markConversationRead({ conversationId: activeConversationId as never });
  }, [activeConversationId, markConversationRead, messagesData?.messages.length]);

  const selectedConversation = useMemo(
    () => conversations?.find((c) => c._id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );

  const listContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showNewMessagesButton, setShowNewMessagesButton] = useState(false);
  const lastMessageCountRef = useRef(0);

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const threshold = 48;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      setIsNearBottom(nearBottom);
      if (nearBottom) {
        setShowNewMessagesButton(false);
      }
    };

    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = listContainerRef.current;
    const count = messagesData?.messages.length ?? 0;
    const hasNewMessages = count > lastMessageCountRef.current;
    lastMessageCountRef.current = count;

    if (!el || !hasNewMessages) return;

    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
      queueMicrotask(() => {
        setShowNewMessagesButton(false);
      });
      return;
    }

    queueMicrotask(() => {
      setShowNewMessagesButton(true);
    });
  }, [isNearBottom, messagesData?.messages.length]);

  const openConversationWithUser = async (otherUserId: string) => {
    try {
      const conversationId = await openDirectConversation({ otherUserId: otherUserId as never });
      setSelectedConversationId(conversationId as unknown as string);
      setMobileMode("chat");
      setSearchText("");
    } catch (error) {
      console.error(error);
    }
  };

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();

    if (!activeConversationId || !messageText.trim()) return;

    const payload = messageText;
    setMessageText("");

    try {
      await sendMessage({
        conversationId: activeConversationId as never,
        body: payload,
      });
      setFailedMessage(null);
      await setTyping({
        conversationId: activeConversationId as never,
        isTyping: false,
      });
    } catch {
      setFailedMessage(payload);
      setMessageText(payload);
    }
  };

  const retryLastFailedMessage = async () => {
    if (!activeConversationId || !failedMessage) return;

    try {
      await sendMessage({
        conversationId: activeConversationId as never,
        body: failedMessage,
      });
      setFailedMessage(null);
      setMessageText("");
    } catch {
      // keep failed message visible
    }
  };

  const onMessageInputChange = (value: string) => {
    setMessageText(value);

    if (!activeConversationId) return;

    void setTyping({
      conversationId: activeConversationId as never,
      isTyping: value.trim().length > 0,
    });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      void setTyping({
        conversationId: activeConversationId as never,
        isTyping: false,
      });
    }, 2_000);
  };

  const onCreateGroup = async () => {
    try {
      setGroupError(null);
      const conversationId = await createGroupConversation({
        name: groupName,
        memberIds: groupMemberIds as never,
      });
      setSelectedConversationId(conversationId as unknown as string);
      setShowGroupCreator(false);
      setGroupName("");
      setGroupMemberIds([]);
      setMobileMode("chat");
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : "Failed to create group");
    }
  };

  if (!isSignedIn) {
    return (
      <main className="grid min-h-screen place-items-center bg-gradient-to-br from-cyan-100 via-white to-emerald-100 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Tars Live Chat</h1>
          <p className="mt-3 text-sm text-slate-600">
            Real-time direct messaging with online presence, unread counts, and typing indicators.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            <SignInButton mode="modal">
              <button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50">
                Create Account
              </button>
            </SignUpButton>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-6">
          <div className="mx-auto flex h-[calc(100vh-1.5rem)] max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl sm:h-[calc(100vh-3rem)]">
            <aside
              className={clsx(
                "h-full w-full border-r border-slate-200 md:block md:w-[340px]",
                mobileMode === "chat" ? "hidden" : "block",
              )}
            >
              <div className="border-b border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Messages</h2>
                    <p className="text-xs text-slate-500">{me?.name ?? "Loading..."}</p>
                  </div>
                  <UserButton />
                </div>
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search users..."
                  className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-cyan-300 placeholder:text-slate-400 focus:ring"
                />
              </div>

              <div className="h-[42%] overflow-y-auto border-b border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Start New Chat
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowGroupCreator((current) => !current);
                      setGroupError(null);
                    }}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    New Group
                  </button>
                </div>

                {showGroupCreator && (
                  <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold text-slate-700">Create Group</p>
                    <input
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="Group name"
                      className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:ring"
                    />
                    <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                      {(allUsers ?? []).map((candidate) => {
                        const checked = groupMemberIds.includes(candidate._id);
                        return (
                          <label
                            key={candidate._id}
                            className="flex cursor-pointer items-center justify-between text-xs"
                          >
                            <span className="truncate pr-2">{candidate.name}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setGroupMemberIds((prev) => {
                                  if (e.target.checked) {
                                    return [...prev, candidate._id];
                                  }
                                  return prev.filter((id) => id !== candidate._id);
                                });
                              }}
                            />
                          </label>
                        );
                      })}
                    </div>
                    {groupError && <p className="mt-2 text-[11px] text-red-600">{groupError}</p>}
                    <button
                      type="button"
                      onClick={onCreateGroup}
                      className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      disabled={groupName.trim().length < 2 || groupMemberIds.length < 2}
                    >
                      Create Group
                    </button>
                  </div>
                )}

                {!users ? (
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Loading users...</p>
                ) : users.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                    {searchText ? "No users found." : "No other users available yet."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {users.map((chatUser) => (
                      <li key={chatUser._id}>
                        <button
                          type="button"
                          onClick={() => openConversationWithUser(chatUser._id as unknown as string)}
                          className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-slate-50"
                        >
                          <div className="relative">
                            <Avatar name={chatUser.name} imageUrl={chatUser.imageUrl} />
                            <span
                              className={clsx(
                                "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white",
                                chatUser.isOnline ? "bg-green-500" : "bg-slate-300",
                              )}
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">{chatUser.name}</p>
                            <p className="truncate text-xs text-slate-500">{chatUser.email}</p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="h-[58%] overflow-y-auto p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Conversations
                </h3>
                {!conversations ? (
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Loading conversations...</p>
                ) : conversations.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                    No conversations yet. Start one from the user list above.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {conversations.map((conversation) => (
                      <li key={conversation._id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedConversationId(conversation._id as unknown as string);
                            setMobileMode("chat");
                          }}
                          className={clsx(
                            "flex w-full items-center gap-3 rounded-xl p-2 text-left transition",
                            activeConversationId === conversation._id
                              ? "bg-cyan-50"
                              : "hover:bg-slate-50",
                          )}
                        >
                          <div className="relative">
                            <Avatar
                              name={conversation.title}
                              imageUrl={conversation.imageUrl ?? ""}
                            />
                            {!conversation.isGroup && (
                              <span
                                className={clsx(
                                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white",
                                  conversation.isOtherOnline ? "bg-green-500" : "bg-slate-300",
                                )}
                              />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-900">{conversation.title}</p>
                            <p className="truncate text-xs text-slate-500">
                              {conversation.latestMessage?.body ?? "No messages yet"}
                            </p>
                          </div>

                          {conversation.unreadCount > 0 && (
                            <span className="rounded-full bg-cyan-500 px-2 py-0.5 text-xs font-semibold text-white">
                              {conversation.unreadCount}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>

            <section
              className={clsx(
                "h-full flex-1 md:block",
                mobileMode === "chat" ? "block" : "hidden",
              )}
            >
              {!activeConversationId || !selectedConversation ? (
                <div className="grid h-full place-items-center p-6 text-center">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">Pick a conversation</h3>
                    <p className="mt-2 text-sm text-slate-500">
                      Select a chat from the sidebar or start a new one.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <header className="flex items-center justify-between border-b border-slate-200 p-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setMobileMode("list")}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs md:hidden"
                      >
                        Back
                      </button>
                      <div className="relative">
                        <Avatar
                          name={selectedConversation.title}
                          imageUrl={selectedConversation.imageUrl ?? ""}
                        />
                        {!selectedConversation.isGroup && (
                          <span
                            className={clsx(
                              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white",
                              selectedConversation.isOtherOnline ? "bg-green-500" : "bg-slate-300",
                            )}
                          />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{selectedConversation.title}</p>
                        <p className="text-xs text-slate-500">
                          {selectedConversation.isGroup
                            ? `${selectedConversation.memberCount} members`
                            : selectedConversation.isOtherOnline
                              ? "Online"
                              : "Offline"}
                        </p>
                      </div>
                    </div>
                  </header>

                  <div ref={listContainerRef} className="relative flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
                    {!messagesData ? (
                      <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                        Loading messages...
                      </p>
                    ) : messagesData.messages.length === 0 ? (
                      <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">
                        No messages yet. Say hello to start the conversation.
                      </p>
                    ) : (
                      messagesData.messages.map((message) => (
                        <div
                          key={message._id}
                          className={clsx(
                            "flex",
                            message.isMine ? "justify-end" : "justify-start",
                          )}
                        >
                          <div
                            className={clsx(
                              "max-w-[75%] rounded-2xl px-3 py-2",
                              message.isMine
                                ? "bg-slate-900 text-white"
                                : "border border-slate-200 bg-white text-slate-900",
                            )}
                          >
                            {!message.isMine && (
                              <p className="mb-1 text-xs font-semibold text-slate-500">
                                {message.senderName}
                              </p>
                            )}
                            {message.deleted ? (
                              <p className="text-sm italic text-slate-400">This message was deleted</p>
                            ) : (
                              <p className="text-sm break-words">{message.body}</p>
                            )}
                            <div className="mt-1 flex items-center gap-2 text-[11px] opacity-75">
                              <span>{formatMessageTime(message.createdAt)}</span>
                              {message.isMine && !message.deleted && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    deleteOwnMessage({
                                      messageId: message._id as never,
                                    })
                                  }
                                  className="underline"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                            {!message.deleted && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {REACTION_EMOJIS.map((emoji) => {
                                  const reaction = message.reactions.find(
                                    (entry) => entry.emoji === emoji,
                                  );
                                  const count = reaction?.count ?? 0;
                                  const reactedByMe = reaction?.reactedByMe ?? false;
                                  return (
                                    <button
                                      key={`${message._id}-${emoji}`}
                                      type="button"
                                      onClick={() =>
                                        toggleReaction({
                                          messageId: message._id as never,
                                          emoji,
                                        })
                                      }
                                      className={clsx(
                                        "rounded-full border px-2 py-0.5 text-[11px]",
                                        reactedByMe
                                          ? "border-cyan-500 bg-cyan-100 text-cyan-800"
                                          : "border-slate-300 bg-white/80",
                                      )}
                                    >
                                      {emoji} {count > 0 ? count : ""}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}

                    {messagesData?.typingUserName && (
                      <div className="text-xs text-slate-500">
                        {messagesData.typingUserName} is typing...
                      </div>
                    )}

                    {showNewMessagesButton && (
                      <button
                        type="button"
                        onClick={() => {
                          const el = listContainerRef.current;
                          if (!el) return;
                          el.scrollTop = el.scrollHeight;
                          setShowNewMessagesButton(false);
                        }}
                        className="sticky bottom-3 mx-auto block rounded-full bg-slate-900 px-4 py-1 text-xs font-semibold text-white"
                      >
                        New messages ↓
                      </button>
                    )}
                  </div>

                  <form onSubmit={submitMessage} className="border-t border-slate-200 p-3">
                    {failedMessage && (
                      <div className="mb-2 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        <span>Message failed to send.</span>
                        <button
                          type="button"
                          onClick={retryLastFailedMessage}
                          className="font-semibold underline"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        value={messageText}
                        onChange={(e) => onMessageInputChange(e.target.value)}
                        placeholder="Type a message"
                        className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-cyan-300 focus:ring"
                      />
                      <button
                        type="submit"
                        disabled={!messageText.trim()}
                        className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Send
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </section>
          </div>
        </main>
  );
}
