# Deployment Guide for Slack Bot Edge Functions

## Prerequisites

1. **Install Supabase CLI**
   
   **For WSL/Linux (Recommended for your setup):**
   ```bash
   # Option 1: Using npx (No installation needed)
   npx supabase --version
   
   # Option 2: Install Homebrew first, then Supabase CLI
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install supabase/tap/supabase
   
   # Option 3: Direct download (if Homebrew doesn't work)
   curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar -xz
   sudo mv supabase /usr/local/bin/
   ```

2. **Login to Supabase**
   ```bash
   # If using npx
   npx supabase login
   
   # If installed globally
   supabase login
   ```

3. **Link to your Supabase project**
   
   **First, find your Project Reference:**
   - Go to [supabase.com/dashboard](https://supabase.com/dashboard)
   - Select your project
   - In the **Settings** > **General** tab, find "Reference ID"
   - OR look at your project URL: `https://supabase.com/dashboard/project/YOUR_PROJECT_REF`
   - OR check your project's API URL: `https://YOUR_PROJECT_REF.supabase.co`
   
   ```bash
   # Replace YOUR_PROJECT_REF with your actual project reference
   # Example: npx supabase link --project-ref abcdefghijklmnop
   
   # If using npx
   npx supabase link --project-ref YOUR_PROJECT_REF
   
   # If installed globally
   supabase link --project-ref YOUR_PROJECT_REF
   ```

## Environment Variables Setup

Before deploying, set these environment variables in your Supabase dashboard:

### Required Variables
- `SLACK_BOT_TOKEN` - Your Slack Bot User OAuth Token (starts with `xoxb-`)
- `SLACK_SIGNING_SECRET` - Your Slack App Signing Secret
- `GEMINI_API_KEY` - Your Google Gemini API key
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anon public key

### How to set environment variables:
1. Go to your Supabase Dashboard
2. Navigate to **Edge Functions** > **Environment Variables**
3. Add each variable with its value

## Database Setup

1. **Run the schema migration** (if not already done):
   ```bash
   # If using npx
   npx supabase db push
   
   # If installed globally
   supabase db push
   ```

## Deploy Edge Functions

Deploy both functions:

```bash
# Deploy the events function
npx supabase functions deploy slack-events
# OR: supabase functions deploy slack-events

# Deploy the commands function  
npx supabase functions deploy slack-commands
# OR: supabase functions deploy slack-commands
```

Or deploy all functions at once:
```bash
npx supabase functions deploy
# OR: supabase functions deploy
```

## Configure Slack App

After deployment, update your Slack App configuration:

### Event Subscriptions
- **Request URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-events`
- **Subscribe to bot events**:
  - `app_mention`
  - `message.im` (for direct messages)
  - `reaction_added`
  - `reaction_removed`

### Slash Commands
Create these slash commands in your Slack App:

1. `/clear`
   - **Request URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-commands`
   - **Description**: Clear conversation history

2. `/new-chat`
   - **Request URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-commands`
   - **Description**: Start a new conversation

3. `/delete-data`
   - **Request URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-commands`
   - **Description**: Delete all conversation data

4. `/mute`
   - **Request URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-commands`
   - **Description**: Mute bot responses

5. `/unmute`
   - **Request URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-commands`
   - **Description**: Unmute bot responses

6. `/stats`
   - **Request URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-commands`
   - **Description**: Show conversation statistics

7. `/help`
   - **Request URL**: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/slack-commands`
   - **Description**: Show help information

### OAuth Scopes Required
Make sure your Slack App has these scopes:
- `app_mentions:read`
- `chat:write`
- `im:history`
- `im:read`
- `reactions:read`
- `users:read`
- `channels:read`
- `groups:read`
- `mpim:read`

## Testing

1. **Test the functions locally** (optional):
   ```bash
   npx supabase functions serve
   # OR: supabase functions serve
   ```

2. **Check function logs**:
   - Go to [Supabase Dashboard](https://supabase.com/dashboard/project/xbkkjrimtkeitwmifnqe/functions)
   - Click on your function name (slack-events or slack-commands)
   - View logs in the "Logs" tab

3. **Test in Slack**:
   - Send a direct message to your bot
   - Mention your bot in a channel
   - Try slash commands like `/help`
   - Add reactions to bot messages

## Monitoring

Monitor your functions:
- **Supabase Dashboard** > **Edge Functions** > **Logs**
- **Slack API Dashboard** for webhook delivery status
- **Database** > **Table Editor** to see stored conversations

## Troubleshooting

### Common Issues:

1. **Function timeout (3 seconds)**
   - Edge Functions respond immediately and process in background
   - Check logs for any async operation errors

2. **Slack verification failed**
   - Ensure `SLACK_SIGNING_SECRET` is correct
   - Check timestamp difference (should be within 5 minutes)

3. **Database connection issues**
   - Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY`
   - Check database schema is properly deployed

4. **Gemini API errors**
   - Verify `GEMINI_API_KEY` is valid
   - Check API quota and billing

### Checking Logs:
- **Supabase Dashboard**: Go to [Functions > Logs](https://supabase.com/dashboard/project/xbkkjrimtkeitwmifnqe/functions)
- **Real-time monitoring**: Click on function name and view "Logs" tab
- **Error tracking**: Check for any runtime errors or timeout issues

## Performance Benefits

Edge Functions provide:
- **Global distribution** - Deploy to 8+ regions worldwide
- **Sub-100ms cold starts** - Faster than traditional serverless
- **Automatic scaling** - Handles high traffic automatically
- **No timeout issues** - Better than Next.js API routes for Slack webhooks

## Security Features

- **Request verification** - All Slack requests are cryptographically verified
- **Environment isolation** - Secrets stored securely in Supabase
- **Database security** - Row-level security policies enforced
- **Rate limiting** - Built-in protection against abuse

Your Slack bot is now running on Supabase Edge Functions! 🚀