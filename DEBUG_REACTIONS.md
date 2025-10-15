# Debugging Emoji Reactions

## Current Issue
The reaction events are being received but the bot can't find the corresponding bot response in the database.

## Debug Steps

### 1. Check Slack App Permissions
Make sure your Slack app has these event subscriptions:
- `reaction_added`
- `reaction_removed`

### 2. Check Bot Response Storage
Run this query in Supabase to see if bot responses have timestamps:

```sql
SELECT id, content, slack_message_ts, created_at 
FROM bot_responses 
ORDER BY created_at DESC 
LIMIT 10;
```

### 3. Check Reaction Events
Look at the edge function logs to see the exact event structure being received.

### 4. Test with a Fresh Message
1. Send a new message to the bot
2. Check if the response gets stored with `slack_message_ts`
3. Then add a reaction to test

### 5. Manual Database Insert Test
If needed, you can manually test reaction storage:

```sql
-- First, get a bot response ID
SELECT id FROM bot_responses ORDER BY created_at DESC LIMIT 1;

-- Then insert a test reaction
INSERT INTO message_reactions (response_id, slack_user_id, reaction_name)
VALUES ('your-response-id', 'your-slack-user-id', 'thumbsup');
```

## Expected Log Flow
When working correctly, you should see these logs:
1. "Handling reaction added"
2. "Looking for bot response with timestamp: X"
3. "Found bot response by timestamp: Y" OR "Using most recent response as fallback: Y"
4. "Reaction added to database"
5. "Sent reaction response: [message]"

## Current Status
- ✅ Reaction events are being received
- ❌ Bot response lookup is failing
- ❌ Reactions not being stored in database
- ❌ No response messages being sent

## Next Steps
1. Deploy the updated edge function code
2. Send a fresh message to the bot to ensure timestamps are stored
3. Test reaction on the fresh message
4. Check logs and database to verify the complete flow