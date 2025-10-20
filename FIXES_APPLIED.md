# Fixes Applied to Slack Gemini Bot

## Issue: Bot Not Responding to Mentions in Channels

### Problem
The bot was only responding to direct messages but not to mentions in channels (e.g., `@BotName hello`). This was because the Slack events handler was only processing `message` events but not `app_mention` events.

### Solution
1. **Updated `slack-events-centralized` Edge Function**:
   - Added handling for `app_mention` events in addition to existing `message` events
   - Created a shared `processSlackMessage` function to avoid code duplication
   - Added logic to strip the bot mention from messages (e.g., `<@BOT_ID> hello` → `hello`)
   - Both event types now use the same processing logic

2. **Updated Deployment Scripts**:
   - Added documentation to both `deploy.sh` and `deploy.bat` about required Slack event subscriptions
   - Added information about required OAuth scopes

### Technical Details

#### New Event Handling
The updated function now handles both:
- `message` events (direct messages)
- `app_mention` events (mentions in channels)

#### Mention Parsing
When processing `app_mention` events, the bot now:
1. Receives the full message text (e.g., `<@U1234567890> hello there`)
2. Strips the mention prefix using regex: `^<@[A-Z0-9]+>\s*`
3. Processes only the actual query text (e.g., `hello there`)

#### Code Structure
- Created a shared `processSlackMessage` function to handle the common processing logic
- Both event types call this function to avoid code duplication
- Maintains all existing functionality while adding the new mention support

### Required Actions
After deploying these changes, you need to:

1. **Deploy the updated functions**:
   ```bash
   ./deploy.sh
   # or on Windows:
   deploy.bat
   ```

2. **Update Slack App Configuration**:
   - Ensure Event Subscriptions include `app_mention` events
   - Verify OAuth scopes include `app_mentions:read`

3. **Test the bot**:
   - Try mentioning the bot in a channel: `@BotName hello`
   - Send a direct message to the bot
   - Both should now work correctly

### Files Modified
- `supabase/functions/slack-events-centralized/index.ts` - Main fix
- `deploy.sh` - Updated documentation
- `deploy.bat` - Updated documentation

The bot should now respond correctly when mentioned in channels as well as in direct messages.