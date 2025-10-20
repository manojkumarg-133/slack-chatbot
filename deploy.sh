#!/bin/bash

# Deploy Supabase Edge Functions
echo "🚀 Deploying Supabase Edge Functions..."

# Deploy slack-events-centralized function
echo "📡 Deploying slack-events-centralized..."
npx supabase functions deploy slack-events-centralized

# Deploy slack-commands function  
echo "📨 Deploying slack-commands..."
npx supabase functions deploy slack-commands

echo "✅ Deployment complete!"
echo ""
echo "🔧 Next steps:"
echo "1. Update your Slack app Event Subscriptions URL to:"
echo "   https://your-project-ref.supabase.co/functions/v1/slack-events-centralized"
echo ""
echo "2. In your Slack app Event Subscriptions, make sure to subscribe to these bot events:"
echo "   - app_mention"
echo "   - message.im"
echo "   - reaction_added"
echo "   - reaction_removed"
echo ""
echo "3. Update your Slack app Slash Commands URL to:"
echo "   https://your-project-ref.supabase.co/functions/v1/slack-commands"
echo ""
echo "4. Make sure these environment variables are set in Supabase dashboard:"
echo "   - SLACK_BOT_TOKEN"
echo "   - SLACK_SIGNING_SECRET"
echo "   - GEMINI_API_KEY"
echo ""
echo "5. In your Slack app OAuth & Permissions, ensure these scopes are added:"
echo "   - app_mentions:read"
echo "   - chat:write"
echo "   - im:history"
echo "   - im:read"
echo "   - reactions:read"
echo "   - users:read"
echo "   - channels:read"
echo "   - groups:read"
echo "   - mpim:read"