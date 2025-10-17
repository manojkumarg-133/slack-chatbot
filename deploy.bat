@echo off
REM Deploy Supabase Edge Functions for Windows

echo 🚀 Deploying Supabase Edge Functions...

REM Deploy slack-events-centralized function
echo 📡 Deploying slack-events-centralized...
npx supabase functions deploy slack-events-centralized

REM Deploy slack-commands function  
echo 📨 Deploying slack-commands...
npx supabase functions deploy slack-commands

echo ✅ Deployment complete!
echo.
echo 🔧 Next steps:
echo 1. Update your Slack app Event Subscriptions URL to:
echo    https://your-project-ref.supabase.co/functions/v1/slack-events-centralized
echo.
echo 2. Update your Slack app Slash Commands URL to:
echo    https://your-project-ref.supabase.co/functions/v1/slack-commands
echo.
echo 3. Make sure these environment variables are set in Supabase dashboard:
echo    - SLACK_BOT_TOKEN
echo    - SLACK_SIGNING_SECRET
echo    - GEMINI_API_KEY

pause