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
import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { format } from "date-fns";
import clsx from "clsx";
import Image from "next/image";
import { Loader2, MessageCircleOff, Paperclip, SearchX, Smile, UserPlus, UsersRound, X } from "lucide-react";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢"] as const;
const MESSAGE_PAYLOAD_PREFIX = "__CHAT_PAYLOAD__";
const CHAT_THEME_STORAGE_KEY = "tars-chat-theme";

type ChatThemeKey = "graphite" | "carbon" | "ash" | "smoke";

const CHAT_THEMES: Record<
  ChatThemeKey,
  { label: string; previewClass: string; style: CSSProperties }
> = {
  graphite: {
    label: "Graphite",
    previewClass: "bg-gradient-to-br from-zinc-700 via-zinc-800 to-black",
    style: {
      backgroundColor: "#0b0d12",
      backgroundImage:
        "radial-gradient(circle at 12% 18%, rgba(255,255,255,0.05), transparent 34%), radial-gradient(circle at 84% 8%, rgba(255,255,255,0.04), transparent 28%), linear-gradient(180deg, #090b10 0%, #0f1218 100%)",
    },
  },
  carbon: {
    label: "Carbon",
    previewClass: "bg-gradient-to-br from-neutral-600 via-neutral-800 to-black",
    style: {
      backgroundColor: "#0a0a0a",
      backgroundImage:
        "linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.03) 75%, transparent 75%, transparent), linear-gradient(180deg, #090909 0%, #111111 100%)",
      backgroundSize: "28px 28px, cover",
    },
  },
  ash: {
    label: "Ash",
    previewClass: "bg-gradient-to-br from-slate-600 via-slate-800 to-zinc-900",
    style: {
      backgroundColor: "#0f1115",
      backgroundImage:
        "radial-gradient(circle at 10% 90%, rgba(255,255,255,0.04), transparent 35%), radial-gradient(circle at 90% 0%, rgba(255,255,255,0.04), transparent 32%), linear-gradient(180deg, #0e1116 0%, #161b22 100%)",
    },
  },
  smoke: {
    label: "Smoke",
    previewClass: "bg-gradient-to-br from-zinc-500 via-zinc-700 to-zinc-900",
    style: {
      backgroundColor: "#101215",
      backgroundImage:
        "repeating-linear-gradient(0deg, rgba(255,255,255,0.02), rgba(255,255,255,0.02) 1px, transparent 1px, transparent 9px), linear-gradient(180deg, #0f1216 0%, #181c23 100%)",
    },
  },
};

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

type AttachmentPayload = {
  name: string;
  sizeKb: number;
  type: string;
  dataUrl?: string;
};

type ParsedMessagePayload = {
  text: string;
  attachment?: AttachmentPayload;
};

function formatFileSize(sizeKb: number) {
  if (sizeKb >= 1024) {
    return `${(sizeKb / 1024).toFixed(1)} MB`;
  }
  return `${sizeKb} KB`;
}

function parseMessagePayload(raw: string): ParsedMessagePayload {
  if (!raw.startsWith(MESSAGE_PAYLOAD_PREFIX)) {
    return { text: raw };
  }

  try {
    const parsed = JSON.parse(
      raw.slice(MESSAGE_PAYLOAD_PREFIX.length),
    ) as ParsedMessagePayload;
    return {
      text: parsed.text ?? "",
      attachment: parsed.attachment,
    };
  } catch {
    return { text: raw };
  }
}

function buildMessagePayload(text: string, attachment?: AttachmentPayload) {
  if (!attachment) {
    return text;
  }

  return `${MESSAGE_PAYLOAD_PREFIX}${JSON.stringify({ text, attachment })}`;
}

function getMessagePreview(raw: string) {
  const parsed = parseMessagePayload(raw);
  if (!parsed.attachment) {
    return parsed.text || "No messages yet";
  }

  const attachmentLabel = parsed.attachment.type.startsWith("image/")
    ? "Photo"
    : `Attachment: ${parsed.attachment.name}`;
  return parsed.text ? `${attachmentLabel} • ${parsed.text}` : attachmentLabel;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getInitialChatTheme(): ChatThemeKey {
  if (typeof window === "undefined") {
    return "graphite";
  }
  const savedTheme = localStorage.getItem(CHAT_THEME_STORAGE_KEY) as ChatThemeKey | null;
  return savedTheme && savedTheme in CHAT_THEMES ? savedTheme : "graphite";
}

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
      <Image
        src={imageUrl}
        alt={name}
        className="h-9 w-9 rounded-full object-cover"
        width={36}
        height={36}
        unoptimized
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

function SidebarSkeletonList() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`skeleton-${index}`}
          className="flex animate-pulse items-center gap-3 rounded-xl border border-slate-800/70 bg-slate-900/60 p-2"
        >
          <div className="h-9 w-9 rounded-full bg-slate-700/80" />
          <div className="min-w-0 flex-1">
            <div className="h-3 w-24 rounded bg-slate-700/80" />
            <div className="mt-2 h-2.5 w-36 rounded bg-slate-800/80" />
          </div>
        </div>
      ))}
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
  const [chatStartMode, setChatStartMode] = useState<"direct" | "group">("direct");
  const [groupName, setGroupName] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [chatTheme, setChatTheme] = useState<ChatThemeKey>(getInitialChatTheme);
  const [reactionMenuForMessageId, setReactionMenuForMessageId] = useState<string | null>(null);

  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const directUsers = users ?? [];

  useEffect(() => {
    if (!user) return;

    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses?.[0]?.emailAddress ??
      `${user.id}@clerk.local`;

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

  useEffect(() => {
    localStorage.setItem(CHAT_THEME_STORAGE_KEY, chatTheme);
  }, [chatTheme]);

  const selectedConversation = useMemo(
    () => conversations?.find((c) => c._id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );
  const activeChatTheme = CHAT_THEMES[chatTheme];

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
      setReactionMenuForMessageId(null);
      setMobileMode("chat");
      setSearchText("");
    } catch (error) {
      console.error(error);
    }
  };

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault();

    if (!activeConversationId) return;

    const text = messageText.trim();
    let attachmentPayload: AttachmentPayload | undefined;

    if (attachedFile) {
      attachmentPayload = {
        name: attachedFile.name,
        sizeKb: Math.max(1, Math.round(attachedFile.size / 1024)),
        type: attachedFile.type || "application/octet-stream",
      };

      if (attachedFile.size <= 1_500 * 1024) {
        try {
          attachmentPayload.dataUrl = await readFileAsDataUrl(attachedFile);
        } catch {
          attachmentPayload.dataUrl = undefined;
        }
      }
    }

    const payload = buildMessagePayload(text, attachmentPayload);
    if (!payload) return;

    setMessageText("");

    try {
      await sendMessage({
        conversationId: activeConversationId as never,
        body: payload,
      });
      setAttachedFile(null);
      setFailedMessage(null);
      await setTyping({
        conversationId: activeConversationId as never,
        isTyping: false,
      });
    } catch {
      setFailedMessage(payload);
      setMessageText(text);
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
      setChatStartMode("direct");
      setGroupName("");
      setGroupMemberIds([]);
      setMobileMode("chat");
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : "Failed to create group");
    }
  };

  if (!isSignedIn) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07090f] p-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/85 p-8 shadow-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">Tars Live Chat</h1>
          <p className="mt-3 text-sm text-slate-300">
            Real-time direct messaging with online presence, unread counts, and typing indicators.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            <SignInButton mode="modal">
              <button className="rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-white">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800">
                Create Account
              </button>
            </SignUpButton>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-[100dvh] w-screen bg-transparent p-0">
          <div className="flex h-full w-full overflow-hidden border border-slate-800 bg-[#0c0f15]">
            <aside
              className={clsx(
                "h-full w-full border-r border-slate-800 bg-[#11141b] md:block md:w-[340px]",
                mobileMode === "chat" ? "hidden" : "block",
              )}
            >
              <div className="border-b border-slate-800 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-100">Messages</h2>
                    <p className="text-xs text-slate-400">{me?.name ?? "Loading..."}</p>
                  </div>
                  <UserButton />
                </div>
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search users..."
                  className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-slate-400 placeholder:text-slate-500 focus:ring"
                />
              </div>

              <div className="h-[42%] overflow-y-auto border-b border-slate-800 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Start New Chat
                  </h3>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setChatStartMode("direct");
                      setGroupError(null);
                    }}
                    className={clsx(
                      "inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition",
                      chatStartMode === "direct"
                        ? "border-slate-500 bg-slate-700 text-slate-100"
                        : "border-slate-700 text-slate-300 hover:bg-slate-800",
                    )}
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    New Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setChatStartMode("group");
                      setGroupError(null);
                    }}
                    className={clsx(
                      "inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition",
                      chatStartMode === "group"
                        ? "border-slate-500 bg-slate-700 text-slate-100"
                        : "border-slate-700 text-slate-300 hover:bg-slate-800",
                    )}
                  >
                    <UsersRound className="h-3.5 w-3.5" />
                    Make Group
                  </button>
                </div>

                {chatStartMode === "group" && (
                  <div className="mb-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
                    <p className="text-xs font-semibold text-slate-300">Create Group</p>
                    <input
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="Group name"
                      className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-100 outline-none focus:ring"
                    />
                    <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-lg border border-slate-700 p-2">
                      {(allUsers ?? []).map((candidate) => {
                        const checked = groupMemberIds.includes(candidate._id);
                        return (
                          <label
                            key={candidate._id}
                            className="flex cursor-pointer items-center justify-between rounded-md px-1.5 py-1 text-xs text-slate-200 transition hover:bg-slate-800/70"
                          >
                            <span className="truncate pr-2 font-medium">{candidate.name}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              className="h-4 w-4 accent-slate-300"
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
                      className="mt-2 w-full rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-900 disabled:opacity-50"
                      disabled={groupName.trim().length < 2 || groupMemberIds.length < 2}
                    >
                      Create Group
                    </button>
                  </div>
                )}

                {chatStartMode === "direct" && !users ? (
                  <SidebarSkeletonList />
                ) : chatStartMode === "direct" && directUsers.length === 0 ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-center">
                    {searchText ? (
                      <SearchX className="mx-auto h-5 w-5 text-slate-500" />
                    ) : (
                      <MessageCircleOff className="mx-auto h-5 w-5 text-slate-500" />
                    )}
                    <p className="mt-2 text-sm text-slate-400">
                      {searchText ? "No users found." : "No other users available yet."}
                    </p>
                  </div>
                ) : chatStartMode === "direct" ? (
                  <ul className="space-y-2">
                    {directUsers.map((chatUser) => (
                      <li key={chatUser._id}>
                        <button
                          type="button"
                          onClick={() => openConversationWithUser(chatUser._id as unknown as string)}
                          className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-all duration-150 hover:bg-slate-800"
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
                            <p className="truncate text-sm font-medium text-slate-100">{chatUser.name}</p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span
                                className={clsx(
                                  "h-1.5 w-1.5 rounded-full",
                                  chatUser.isOnline ? "bg-green-500" : "bg-slate-500",
                                )}
                              />
                              <p
                                className={clsx(
                                  "text-[11px]",
                                  chatUser.isOnline ? "text-green-400" : "text-slate-500",
                                )}
                              >
                                {chatUser.isOnline ? "Online" : "Offline"}
                              </p>
                              <p className="truncate text-[11px] text-slate-500">{chatUser.email}</p>
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl bg-slate-800 p-3 text-sm text-slate-400">
                    Select members and create a group.
                  </p>
                )}
              </div>

              <div className="h-[58%] overflow-y-auto p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Conversations
                </h3>
                {!conversations ? (
                  <SidebarSkeletonList />
                ) : conversations.length === 0 ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-center">
                    <MessageCircleOff className="mx-auto h-5 w-5 text-slate-500" />
                    <p className="mt-2 text-sm text-slate-300">No conversations yet</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Start a direct chat from the list above.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {conversations.map((conversation) => (
                      <li key={conversation._id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedConversationId(conversation._id as unknown as string);
                            setReactionMenuForMessageId(null);
                            setMobileMode("chat");
                          }}
                          className={clsx(
                            "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-all duration-150",
                            activeConversationId === conversation._id
                              ? "bg-slate-700/60 ring-1 ring-slate-600"
                              : "hover:bg-slate-800",
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
                            <p className="truncate text-sm font-medium text-slate-100">{conversation.title}</p>
                            {!conversation.isGroup && (
                              <div className="mb-0.5 mt-0.5 flex items-center gap-1.5">
                                <span
                                  className={clsx(
                                    "h-1.5 w-1.5 rounded-full",
                                    conversation.isOtherOnline ? "bg-green-500" : "bg-slate-500",
                                  )}
                                />
                                <span
                                  className={clsx(
                                    "text-[11px]",
                                    conversation.isOtherOnline ? "text-green-400" : "text-slate-500",
                                  )}
                                >
                                  {conversation.isOtherOnline ? "Online" : "Offline"}
                                </span>
                              </div>
                            )}
                            <p className="truncate text-xs text-slate-400">
                              {conversation.latestMessage
                                ? getMessagePreview(conversation.latestMessage.body)
                                : "No messages yet"}
                            </p>
                          </div>

                          {conversation.unreadCount > 0 && (
                            <span className="rounded-full bg-green-500 px-2 py-0.5 text-xs font-semibold text-black">
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
                "h-full w-full min-h-0 flex-1 md:block",
                mobileMode === "chat" ? "block" : "hidden",
              )}
            >
              {!activeConversationId || !selectedConversation ? (
                <div
                  className="grid h-full place-items-center p-6 text-center"
                  style={activeChatTheme.style}
                >
                  <div className="max-w-sm rounded-2xl border border-slate-700/70 bg-slate-900/70 p-6">
                    <MessageCircleOff className="mx-auto h-6 w-6 text-slate-500" />
                    <h3 className="text-lg font-semibold text-slate-100">Pick a conversation</h3>
                    <p className="mt-2 text-sm text-slate-400">
                      Select a chat from the sidebar or start a new one.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMode("list");
                        setChatStartMode("direct");
                      }}
                      className="mt-4 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                    >
                      Start New Chat
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col" style={activeChatTheme.style}>
                  <header className="flex items-center justify-between border-b border-slate-800 p-4">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setMobileMode("list")}
                        className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200 md:hidden"
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
                        <p className="text-sm font-semibold text-slate-100">{selectedConversation.title}</p>
                        <p className="text-xs text-slate-400">
                          {selectedConversation.isGroup
                            ? `${selectedConversation.memberCount} members`
                            : selectedConversation.isOtherOnline
                              ? "Online"
                              : "Offline"}
                        </p>
                      </div>
                    </div>
                    <div className="hidden items-center gap-2 sm:flex">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Theme
                      </span>
                      {(Object.keys(CHAT_THEMES) as ChatThemeKey[]).map((themeKey) => (
                        <button
                          key={themeKey}
                          type="button"
                          onClick={() => setChatTheme(themeKey)}
                          title={CHAT_THEMES[themeKey].label}
                          className={clsx(
                            "h-5 w-5 rounded-full border transition",
                            CHAT_THEMES[themeKey].previewClass,
                            chatTheme === themeKey
                              ? "border-slate-200 ring-1 ring-slate-300"
                              : "border-slate-600 hover:border-slate-400",
                          )}
                        />
                      ))}
                    </div>
                  </header>

                  <div
                    ref={listContainerRef}
                    className="relative flex-1 space-y-3 overflow-y-auto p-4 md:p-5"
                  >
                    {!messagesData ? (
                      <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-sm text-slate-400">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading messages...
                      </div>
                    ) : messagesData.messages.length === 0 ? (
                      <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-700/80 bg-slate-900/75 p-5 text-center">
                        <MessageCircleOff className="mx-auto h-6 w-6 text-slate-500" />
                        <p className="mt-3 text-sm font-medium text-slate-200">No messages yet</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Say hello to start the conversation.
                        </p>
                      </div>
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
                              "max-w-[88%] rounded-2xl px-3 py-2 md:max-w-[75%]",
                              message.isMine
                                ? "bg-slate-200 text-slate-900"
                                : "border border-slate-700 bg-slate-900 text-slate-100",
                            )}
                          >
                            {(() => {
                              const parsedPayload = parseMessagePayload(message.body);
                              return (
                                <>
                                  {!message.isMine && (
                                    <p className="mb-1 text-xs font-semibold text-slate-500">
                                      {message.senderName}
                                    </p>
                                  )}

                                  {message.deleted ? (
                                    <p className="text-sm italic text-slate-400">This message was deleted</p>
                                  ) : (
                                    <>
                                      {parsedPayload.attachment ? (
                                        <div
                                          className={clsx(
                                            "mb-2 overflow-hidden rounded-xl border",
                                            message.isMine
                                              ? "border-slate-500/60 bg-slate-100"
                                              : "border-slate-600 bg-slate-800/70",
                                          )}
                                        >
                                          {parsedPayload.attachment.dataUrl &&
                                          parsedPayload.attachment.type.startsWith("image/") ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                              src={parsedPayload.attachment.dataUrl}
                                              alt={parsedPayload.attachment.name}
                                              className="max-h-60 w-full object-cover"
                                            />
                                          ) : null}
                                          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                                            <div className="flex min-w-0 items-center gap-2">
                                              <Paperclip className="h-3.5 w-3.5 shrink-0" />
                                              <div className="min-w-0">
                                                <p className="truncate font-semibold">
                                                  {parsedPayload.attachment.name}
                                                </p>
                                                <p className="opacity-80">
                                                  {formatFileSize(parsedPayload.attachment.sizeKb)}
                                                </p>
                                              </div>
                                            </div>
                                            {parsedPayload.attachment.dataUrl ? (
                                              <a
                                                href={parsedPayload.attachment.dataUrl}
                                                download={parsedPayload.attachment.name}
                                                className={clsx(
                                                  "shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold",
                                                  message.isMine
                                                    ? "border-slate-500 text-slate-700"
                                                    : "border-slate-500 text-slate-200",
                                                )}
                                              >
                                                Download
                                              </a>
                                            ) : null}
                                          </div>
                                        </div>
                                      ) : null}
                                      {parsedPayload.text ? (
                                        <p className="text-sm break-words">{parsedPayload.text}</p>
                                      ) : null}
                                    </>
                                  )}
                                </>
                              );
                            })()}
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
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {message.reactions.map((reaction) => (
                                  <button
                                    key={`${message._id}-${reaction.emoji}`}
                                    type="button"
                                    onClick={() =>
                                      toggleReaction({
                                        messageId: message._id as never,
                                        emoji: reaction.emoji,
                                      })
                                    }
                                    className={clsx(
                                      "rounded-full border px-2 py-0.5 text-[11px]",
                                      reaction.reactedByMe
                                        ? "border-slate-400 bg-slate-700 text-slate-100"
                                        : "border-slate-600 bg-slate-800/80 text-slate-300",
                                    )}
                                  >
                                    {reaction.emoji} {reaction.count}
                                  </button>
                                ))}

                                <button
                                  type="button"
                                  onClick={() =>
                                    setReactionMenuForMessageId((prev) =>
                                      prev === (message._id as unknown as string)
                                        ? null
                                        : (message._id as unknown as string),
                                    )
                                  }
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-slate-800/80 text-slate-300 transition hover:bg-slate-700"
                                  aria-label="Add reaction"
                                >
                                  <Smile className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}

                            {!message.deleted &&
                              reactionMenuForMessageId === (message._id as unknown as string) && (
                                <div className="mt-1 flex w-fit flex-wrap items-center gap-1 rounded-full border border-slate-600 bg-slate-900/95 p-1 shadow-xl">
                                  {REACTION_EMOJIS.map((emoji) => (
                                    <button
                                      key={`${message._id}-picker-${emoji}`}
                                      type="button"
                                      onClick={() => {
                                        void toggleReaction({
                                          messageId: message._id as never,
                                          emoji,
                                        });
                                        setReactionMenuForMessageId(null);
                                      }}
                                      className="rounded-full px-1.5 py-0.5 text-sm transition hover:bg-slate-700"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              )}
                          </div>
                        </div>
                      ))
                    )}

                    {messagesData?.typingUserName && (
                      <div className="flex items-center gap-2 text-xs text-slate-300">
                        <span>{messagesData.typingUserName} is typing</span>
                        <span className="inline-flex items-center gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:120ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:240ms]" />
                        </span>
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
                        className="sticky bottom-3 mx-auto block rounded-full bg-slate-200 px-4 py-1 text-xs font-semibold text-slate-900"
                      >
                        New messages ↓
                      </button>
                    )}
                  </div>

                  <form
                    onSubmit={submitMessage}
                    className="border-t border-slate-800 bg-[#141821]/95 p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] backdrop-blur"
                  >
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
                    {attachedFile && (
                      <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300">
                        <Paperclip className="h-3.5 w-3.5" />
                        <span className="max-w-[240px] truncate">{attachedFile.name}</span>
                        <button
                          type="button"
                          onClick={() => setAttachedFile(null)}
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          setAttachedFile(e.target.files?.[0] ?? null);
                          e.currentTarget.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-300 transition hover:bg-slate-800"
                      >
                        <Paperclip className="h-4 w-4" />
                      </button>
                      <input
                        value={messageText}
                        onChange={(e) => onMessageInputChange(e.target.value)}
                        placeholder="Type a message"
                        className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-slate-500 placeholder:text-slate-500 focus:ring"
                      />
                      <button
                        type="submit"
                        disabled={!messageText.trim() && !attachedFile}
                        className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
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
