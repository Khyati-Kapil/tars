# Tars Live Chat

A real-time one-on-one messaging web app built with **Next.js (App Router)**, **TypeScript**, **Convex**, **Clerk**, and **Tailwind CSS**.

## Implemented Features

1. Authentication with Clerk (sign up, sign in, sign out, profile avatar)
2. User discovery + live search (excluding yourself)
3. Direct message conversations (create/open) with realtime updates
4. Message timestamps with today/year-aware formatting
5. Empty states for conversations, messages, and search
6. Responsive layout (desktop split view, mobile list/chat with back button)
7. Real-time online/offline indicator (presence heartbeat)
8. Typing indicator (2-second inactivity timeout)
9. Real-time unread message badge in sidebar
10. Smart auto-scroll + new messages button when user is reading older messages
11. Optional implemented: soft delete own message ("This message was deleted")
13. Optional implemented: loading states + failed send retry UI

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Convex (database + realtime)
- Clerk (authentication)
- Tailwind CSS

## Project Structure

- `app/` - Next.js routes and layout
- `components/chat/` - chat interface UI
- `components/providers/` - Clerk + Convex providers
- `convex/` - schema and backend functions

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env.local
```

3. Fill in `.env.local`:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER_DOMAIN`
- `NEXT_PUBLIC_CONVEX_URL`

4. Initialize Convex and generate code:

```bash
npx convex dev
```

5. Start app:

```bash
npm run dev
```

## Deployment

Deploy on Vercel and add the same environment variables in project settings.

## Loom Video Checklist

Record a 5-minute Loom video and include:

1. 30-second self introduction
2. Camera on, face visible
3. Explain one feature deeply in code
4. Demo app in browser
5. Make one live code change and show result

