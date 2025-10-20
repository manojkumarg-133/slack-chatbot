# Slack Gemini Bot 🤖

A powerful Slack chatbot powered by Google's Gemini AI, built with Next.js, TypeScript, and Supabase.

## 🌟 Features

- **AI-Powered Conversations**: Uses Google's Gemini Pro model for intelligent responses
- **Conversation Threading**: Maintains context across multiple messages
- **User Management**: Tracks all users who interact with the bot
- **Message History**: Stores all conversations in Supabase
- **Analytics**: Track tokens used, processing time, and more
- **Direct Messages**: Supports both @mentions and DMs
- **Error Handling**: Robust error handling and logging
- **TypeScript**: Fully typed for better developer experience

## 📋 Prerequisites

- Node.js 18+ and npm
- A Slack workspace where you have permissions to install apps
- A Google Cloud account with Gemini API access
- A Supabase account and project

## 🚀 Quick Start

See [SETUP.md](./SETUP.md) for detailed step-by-step instructions.

### Quick Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up your services**
   - Create a Slack App
   - Get Gemini API key
   - Create Supabase project
   - Run database schema

3. **Configure environment variables**
   - Copy `.env.local` and fill in your credentials

4. **Deploy**
   ```bash
   vercel
   ```

5. **Configure Slack Event URL**
   - Set to: `https://your-app.vercel.app/api/slack/events`

## 🗄️ Database Schema

### Tables

1. **users** - Stores Slack user information
2. **conversations** - Stores conversation threads
3. **messages** - Stores all messages (queries and responses)
4. **message_reactions** - Stores user reactions/likes

See `supabase/schema.sql` for the complete schema.

## 🔧 Project Structure

```
slack-gemini-bot/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── slack/events/          # Slack event handler
│   │   │   └── analytics/             # Analytics endpoints
│   │   └── ...
│   ├── lib/                       # (Empty - all functionality moved to edge functions)
│   └── types/
│       └── database.types.ts         # TypeScript types
├── supabase/
│   └── schema.sql                    # Database schema
└── SETUP.md                          # Detailed setup guide
```

## 🎯 Usage

### In Slack Channels
```
@GeminiBot What is the capital of France?
```

### In Direct Messages
```
Tell me a joke about programming
```

## 📊 API Endpoints

- `GET /api/analytics/user-stats?slackUserId=U12345`
- `GET /api/analytics/conversation-history?conversationId=xxx`

## 📝 Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_SIGNING_SECRET` | Slack app signing secret |
| `SLACK_BOT_TOKEN` | Slack bot OAuth token |
| `GEMINI_API_KEY` | Google Gemini API key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |

## 📄 License

MIT
