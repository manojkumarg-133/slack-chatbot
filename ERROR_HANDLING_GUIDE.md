# 🛡️ Error Handling Guide & Rollback Procedures
## Centralized Database Migration

This guide provides comprehensive error handling strategies and rollback procedures for migrating your Slack bot to the new centralized database schema.

---

## 📋 Table of Contents

1. [Pre-Migration Error Prevention](#pre-migration-error-prevention)
2. [Migration Error Handling](#migration-error-handling)
3. [Runtime Error Handling](#runtime-error-handling)
4. [Rollback Procedures](#rollback-procedures)
5. [Monitoring and Alerting](#monitoring-and-alerting)
6. [Common Issues and Solutions](#common-issues-and-solutions)

---

## 🚨 Pre-Migration Error Prevention

### 1. Database Backup Strategy

```bash
# 1. Create full database backup
pg_dump -h your-host -U your-user -d your-database \
  --clean --create --verbose \
  --file="backup_$(date +%Y%m%d_%H%M%S).sql"

# 2. Verify backup integrity
psql -h your-host -U your-user -d test_restore_db \
  -f backup_$(date +%Y%m%d_%H%M%S).sql

# 3. Create table-specific backups for critical data
pg_dump -h your-host -U your-user -d your-database \
  --table=messages \
  --table=conversations \
  --table=message_reactions \
  --data-only \
  --file="critical_data_backup.sql"
```

### 2. Environment Validation

```sql
-- Validate environment before migration
DO $$
DECLARE
    table_exists BOOLEAN;
    column_count INTEGER;
    constraint_count INTEGER;
BEGIN
    -- Check if old tables exist and have expected structure
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'messages'
    ) INTO table_exists;
    
    IF NOT table_exists THEN
        RAISE EXCEPTION 'Migration Error: Old messages table not found';
    END IF;
    
    -- Validate data integrity
    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_name = 'messages';
    
    IF column_count < 8 THEN
        RAISE EXCEPTION 'Migration Error: messages table missing expected columns';
    END IF;
    
    RAISE NOTICE 'Pre-migration validation passed ✅';
END
$$;
```

### 3. Dependency Check

```typescript
// Check all required environment variables
const requiredEnvVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!Deno.env.get(envVar)) {
    throw new Error(`❌ Missing required environment variable: ${envVar}`);
  }
}

// Test database connectivity
try {
  const { data, error } = await supabase.from('users').select('count').limit(1);
  if (error) throw error;
  console.log('✅ Database connectivity verified');
} catch (error) {
  throw new Error(`❌ Database connectivity failed: ${error.message}`);
}
```

---

## ⚠️ Migration Error Handling

### 1. Transaction-Based Migration

```sql
-- Main migration with comprehensive error handling
BEGIN;

-- Set up error handling
SET client_min_messages = NOTICE;

-- Create savepoints for rollback granularity
SAVEPOINT before_user_migration;

DO $$
DECLARE
    migration_step TEXT;
    error_count INTEGER := 0;
    max_errors INTEGER := 10;
BEGIN
    -- Step 1: User Migration
    migration_step := 'user_migration';
    
    INSERT INTO users (platform, platform_user_id, username, display_name, platform_metadata)
    SELECT DISTINCT 
        'slack'::platform_type,
        slack_user_id,
        slack_user_id,
        slack_user_id,
        jsonb_build_object('migrated_from_reactions', true)
    FROM message_reactions
    WHERE slack_user_id IS NOT NULL
    ON CONFLICT (platform, platform_user_id) DO NOTHING;
    
    GET DIAGNOSTICS error_count = ROW_COUNT;
    RAISE NOTICE 'Step %: Migrated % users', migration_step, error_count;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '❌ Error in step %: %', migration_step, SQLERRM;
        ROLLBACK TO SAVEPOINT before_user_migration;
        RAISE EXCEPTION 'Migration failed at step: %', migration_step;
END
$$;

-- Continue with other steps, each with its own savepoint
SAVEPOINT before_conversation_migration;
-- ... conversation migration code

-- Final validation
DO $$
DECLARE
    user_count INTEGER;
    conversation_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM users;
    SELECT COUNT(*) INTO conversation_count FROM conversations;
    
    IF user_count = 0 THEN
        RAISE EXCEPTION 'Migration validation failed: No users migrated';
    END IF;
    
    IF conversation_count = 0 THEN
        RAISE EXCEPTION 'Migration validation failed: No conversations migrated';
    END IF;
    
    RAISE NOTICE '✅ Migration validation passed: % users, % conversations', 
        user_count, conversation_count;
END
$$;

COMMIT;
```

### 2. Data Validation During Migration

```sql
-- Comprehensive data validation function
CREATE OR REPLACE FUNCTION validate_migration_step(step_name TEXT)
RETURNS TABLE(
    validation_name TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    CASE step_name
        WHEN 'users' THEN
            RETURN QUERY
            SELECT 
                'user_count'::TEXT,
                CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END,
                'Migrated ' || COUNT(*)::TEXT || ' users'
            FROM users WHERE platform = 'slack';
            
            RETURN QUERY
            SELECT 
                'user_duplicates'::TEXT,
                CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
                'Found ' || COUNT(*)::TEXT || ' duplicate users'
            FROM (
                SELECT platform, platform_user_id, COUNT(*)
                FROM users 
                GROUP BY platform, platform_user_id 
                HAVING COUNT(*) > 1
            ) duplicates;
            
        WHEN 'conversations' THEN
            RETURN QUERY
            SELECT 
                'conversation_user_links'::TEXT,
                CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
                'Found ' || COUNT(*)::TEXT || ' conversations without valid users'
            FROM conversations c
            LEFT JOIN users u ON c.user_id = u.id
            WHERE u.id IS NULL;
            
        WHEN 'messages' THEN
            RETURN QUERY
            SELECT 
                'query_response_balance'::TEXT,
                CASE WHEN ABS(query_count - response_count) <= query_count * 0.1 
                     THEN 'PASS' ELSE 'WARN' END,
                'Queries: ' || query_count::TEXT || ', Responses: ' || response_count::TEXT
            FROM (
                SELECT 
                    (SELECT COUNT(*) FROM user_queries) as query_count,
                    (SELECT COUNT(*) FROM bot_responses) as response_count
            ) counts;
    END CASE;
END
$$ LANGUAGE plpgsql;

-- Use validation function
SELECT * FROM validate_migration_step('users');
SELECT * FROM validate_migration_step('conversations');
SELECT * FROM validate_migration_step('messages');
```

### 3. Error Logging and Recovery

```sql
-- Create migration log table
CREATE TABLE IF NOT EXISTS migration_log (
    id SERIAL PRIMARY KEY,
    step_name TEXT NOT NULL,
    status TEXT NOT NULL, -- 'START', 'SUCCESS', 'ERROR', 'ROLLBACK'
    message TEXT,
    error_details JSONB,
    records_affected INTEGER,
    execution_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migration logging function
CREATE OR REPLACE FUNCTION log_migration_step(
    step_name TEXT,
    status TEXT,
    message TEXT DEFAULT NULL,
    error_details JSONB DEFAULT NULL,
    records_affected INTEGER DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO migration_log (
        step_name, status, message, error_details, records_affected
    ) VALUES (
        step_name, status, message, error_details, records_affected
    );
END
$$ LANGUAGE plpgsql;

-- Example usage in migration
DO $$
DECLARE
    step_start_time TIMESTAMP;
    records_migrated INTEGER;
BEGIN
    -- Log step start
    step_start_time := clock_timestamp();
    PERFORM log_migration_step('user_migration', 'START', 'Beginning user migration');
    
    -- Perform migration
    INSERT INTO users (...) SELECT ... FROM ...;
    GET DIAGNOSTICS records_migrated = ROW_COUNT;
    
    -- Log success
    PERFORM log_migration_step(
        'user_migration', 
        'SUCCESS', 
        'User migration completed',
        NULL,
        records_migrated
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log error
        PERFORM log_migration_step(
            'user_migration',
            'ERROR',
            'User migration failed: ' || SQLERRM,
            jsonb_build_object(
                'sqlstate', SQLSTATE,
                'error_message', SQLERRM,
                'error_detail', SQLERRM
            ),
            0
        );
        RAISE;
END
$$;
```

---

## 🔧 Runtime Error Handling

### 1. Database Helper Function Error Handling

```typescript
// Enhanced error handling in database helpers
export async function upsertUser(
  platform: PlatformType,
  platformUserId: string,
  userData?: Partial<UserInsert>
): Promise<{ success: boolean; user?: User; error?: string; errorCode?: string }> {
  const startTime = performance.now();
  
  try {
    console.log(`👤 Upserting user: ${platform}:${platformUserId}`);

    const userRecord: UserInsert = {
      platform,
      platform_user_id: platformUserId,
      // ... other fields
    };

    const { data: user, error } = await supabase
      .from('users')
      .upsert(userRecord, {
        onConflict: 'platform,platform_user_id',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) {
      // Categorize error for better handling
      let errorCode = 'UNKNOWN_ERROR';
      
      if (error.code === '23505') {
        errorCode = 'UNIQUE_CONSTRAINT_VIOLATION';
      } else if (error.code === '23503') {
        errorCode = 'FOREIGN_KEY_VIOLATION';
      } else if (error.code === '42P01') {
        errorCode = 'TABLE_NOT_FOUND';
      } else if (error.message.includes('timeout')) {
        errorCode = 'DATABASE_TIMEOUT';
      }
      
      console.error(`❌ User upsert error [${errorCode}]:`, error);
      
      // Attempt recovery for certain error types
      if (errorCode === 'UNIQUE_CONSTRAINT_VIOLATION' || errorCode === 'DATABASE_TIMEOUT') {
        // Try to fetch existing user
        const { data: existingUser, error: fetchError } = await supabase
          .from('users')
          .select('*')
          .eq('platform', platform)
          .eq('platform_user_id', platformUserId)
          .single();

        if (existingUser && !fetchError) {
          console.log(`✅ Recovered existing user: ${existingUser.id}`);
          return { success: true, user: existingUser };
        }
      }

      // Log error for monitoring
      await logError('upsertUser', {
        platform,
        platformUserId,
        errorCode,
        error: error.message,
        processingTime: performance.now() - startTime
      });

      return { success: false, error: error.message, errorCode };
    }

    console.log(`✅ User upserted: ${user.id} (${performance.now() - startTime}ms)`);
    return { success: true, user };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Exception in upsertUser:', error);
    
    await logError('upsertUser', {
      platform,
      platformUserId,
      errorCode: 'EXCEPTION',
      error: errorMessage,
      processingTime: performance.now() - startTime
    });
    
    return { success: false, error: errorMessage, errorCode: 'EXCEPTION' };
  }
}

// Error logging helper
async function logError(functionName: string, errorData: any): Promise<void> {
  try {
    await supabase.from('error_log').insert([{
      function_name: functionName,
      error_data: errorData,
      created_at: new Date().toISOString()
    }]);
  } catch (logError) {
    console.error('❌ Failed to log error:', logError);
    // Don't throw - logging failure shouldn't break the main flow
  }
}
```

### 2. Edge Function Error Handling

```typescript
// Comprehensive error handling in Edge Function
async function handleAppMention(event: any, teamId: string): Promise<void> {
  const errorContext = {
    eventType: 'app_mention',
    userId: event.user,
    channelId: event.channel,
    threadTs: event.thread_ts,
    teamId
  };
  
  try {
    // Step 1: User handling with error recovery
    const userResult = await CentralizedDB.createSlackUser(event.user, userInfo, teamId);
    
    if (!userResult.success) {
      throw new Error(`User creation failed: ${userResult.error}`);
    }
    
    // Step 2: Conversation handling with fallback
    let conversationResult = await CentralizedDB.createSlackConversation(
      userResult.user!.id,
      event.channel,
      channelInfo || {},
      event.thread_ts
    );
    
    if (!conversationResult.success) {
      // Fallback: Create minimal conversation
      console.log('⚠️ Falling back to minimal conversation creation');
      conversationResult = await CentralizedDB.getOrCreateConversation(
        'slack',
        userResult.user!.id,
        event.channel,
        event.thread_ts
      );
      
      if (!conversationResult.success) {
        throw new Error(`Conversation creation failed: ${conversationResult.error}`);
      }
    }
    
    // Step 3: Save user query with retry logic
    const queryResult = await retryWithBackoff(
      () => CentralizedDB.saveUserQuery(
        conversationResult.conversation!.id,
        userResult.user!.id,
        messageText,
        event.ts,
        { platformMetadata: queryMetadata }
      ),
      3, // max retries
      1000 // initial delay ms
    );
    
    if (!queryResult.success) {
      throw new Error(`Query saving failed: ${queryResult.error}`);
    }
    
    // Step 4: Generate AI response with timeout
    const aiResponse = await Promise.race([
      generateGeminiResponse(messageText, conversationResult.conversation!.id, event.user),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI response timeout')), 30000)
      )
    ]);
    
    if (!aiResponse || !aiResponse.success) {
      await handleResponseError(queryResult.query!, conversationResult.conversation!, event, null, 
        'AI response generation failed');
      return;
    }
    
    // Continue with response handling...
    
  } catch (error) {
    console.error('❌ Error in handleAppMention:', error);
    
    // Send user-friendly error message
    await sendSlackMessage(
      event.channel,
      "Sorry, I encountered a technical issue. Please try again in a moment. 🤖",
      event.thread_ts
    );
    
    // Log detailed error for debugging
    await logError('handleAppMention', {
      ...errorContext,
      error: error.message,
      stack: error.stack
    });
  }
}

// Retry helper with exponential backoff
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  initialDelayMs: number
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxRetries) {
        break;
      }
      
      const delay = initialDelayMs * Math.pow(2, attempt);
      console.log(`⏳ Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}
```

---

## 🔄 Rollback Procedures

### 1. Complete Migration Rollback

```sql
-- Complete rollback script (run in case of major issues)
BEGIN;

-- Step 1: Backup current state for analysis
CREATE TABLE rollback_backup_users AS SELECT * FROM users;
CREATE TABLE rollback_backup_conversations AS SELECT * FROM conversations;
CREATE TABLE rollback_backup_user_queries AS SELECT * FROM user_queries;
CREATE TABLE rollback_backup_bot_responses AS SELECT * FROM bot_responses;
CREATE TABLE rollback_backup_message_reactions AS SELECT * FROM message_reactions;

-- Step 2: Restore original tables from backup
-- (Assumes you have backup files)
-- TRUNCATE users, conversations, user_queries, bot_responses, message_reactions CASCADE;

-- Step 3: Restore from backup files
-- \i backup_messages.sql
-- \i backup_conversations.sql  
-- \i backup_message_reactions.sql

-- Step 4: Verify rollback
DO $$
DECLARE
    messages_count INTEGER;
    conversations_count INTEGER;
    reactions_count INTEGER;
BEGIN
    -- Check if old tables are restored
    SELECT COUNT(*) INTO messages_count FROM messages;
    SELECT COUNT(*) INTO conversations_count FROM conversations;
    SELECT COUNT(*) INTO reactions_count FROM message_reactions;
    
    IF messages_count = 0 OR conversations_count = 0 THEN
        RAISE EXCEPTION 'Rollback verification failed: Missing data in restored tables';
    END IF;
    
    RAISE NOTICE '✅ Rollback completed: % messages, % conversations, % reactions restored',
        messages_count, conversations_count, reactions_count;
END
$$;

-- Step 5: Clean up new schema tables
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS user_queries CASCADE;
DROP TABLE IF EXISTS bot_responses CASCADE;
-- Keep message_reactions if structure is compatible

COMMIT;
```

### 2. Partial Rollback (Specific Components)

```sql
-- Rollback only user data (keep conversations)
BEGIN;

-- Backup current state
CREATE TABLE partial_rollback_users AS SELECT * FROM users;

-- Restore users to pre-migration state
DELETE FROM users WHERE platform_metadata->>'migrated_from_reactions' = 'true';

-- Update conversations to remove user links for restored users
UPDATE conversations 
SET user_id = (
    SELECT id FROM users 
    WHERE platform_user_id = 'MIGRATION_UNKNOWN_USER' 
    AND platform = 'slack'
)
WHERE user_id NOT IN (SELECT id FROM users);

COMMIT;
```

### 3. Code Rollback Procedure

```bash
#!/bin/bash
# rollback_deployment.sh

echo "🔄 Starting rollback procedure..."

# Step 1: Switch to previous deployment
echo "Switching to backup Edge Function..."
supabase functions deploy slack-events-backup

# Step 2: Restore environment variables if needed
echo "Restoring environment configuration..."
supabase secrets set SLACK_BOT_TOKEN="$BACKUP_SLACK_BOT_TOKEN"

# Step 3: Verify rollback
echo "Testing rollback..."
curl -X POST "$SUPABASE_URL/functions/v1/slack-events-backup" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "url_verification", "challenge": "test"}' \
  --fail --silent --show-error

if [ $? -eq 0 ]; then
  echo "✅ Rollback completed successfully"
else
  echo "❌ Rollback verification failed"
  exit 1
fi
```

---

## 📊 Monitoring and Alerting

### 1. Health Check Functions

```sql
-- Create health monitoring function
CREATE OR REPLACE FUNCTION check_database_health()
RETURNS TABLE(
    component TEXT,
    status TEXT,
    details TEXT,
    last_checked TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    -- Check user table health
    RETURN QUERY
    SELECT 
        'users'::TEXT,
        CASE 
            WHEN COUNT(*) > 0 AND COUNT(*) = COUNT(CASE WHEN platform IS NOT NULL THEN 1 END)
            THEN 'HEALTHY' 
            ELSE 'UNHEALTHY' 
        END,
        'Total users: ' || COUNT(*)::TEXT || ', Valid platforms: ' || COUNT(CASE WHEN platform IS NOT NULL THEN 1 END)::TEXT,
        NOW()
    FROM users;
    
    -- Check conversation integrity
    RETURN QUERY
    SELECT 
        'conversations'::TEXT,
        CASE 
            WHEN orphaned_count = 0 THEN 'HEALTHY'
            WHEN orphaned_count < total_count * 0.01 THEN 'WARNING'
            ELSE 'UNHEALTHY'
        END,
        'Total: ' || total_count::TEXT || ', Orphaned: ' || orphaned_count::TEXT,
        NOW()
    FROM (
        SELECT 
            COUNT(*) as total_count,
            COUNT(CASE WHEN u.id IS NULL THEN 1 END) as orphaned_count
        FROM conversations c
        LEFT JOIN users u ON c.user_id = u.id
    ) health_check;
    
    -- Check recent errors
    RETURN QUERY
    SELECT 
        'error_rate'::TEXT,
        CASE 
            WHEN error_rate < 1 THEN 'HEALTHY'
            WHEN error_rate < 5 THEN 'WARNING'
            ELSE 'UNHEALTHY'
        END,
        'Error rate: ' || error_rate::TEXT || '%',
        NOW()
    FROM (
        SELECT 
            COUNT(CASE WHEN br.error_message IS NOT NULL THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0) as error_rate
        FROM bot_responses br
        WHERE br.created_at >= NOW() - INTERVAL '1 hour'
    ) error_check;
END
$$ LANGUAGE plpgsql;

-- Usage
SELECT * FROM check_database_health();
```

### 2. Error Rate Monitoring

```typescript
// Error rate monitoring in Edge Function
let errorCount = 0;
let requestCount = 0;
const ERROR_RATE_THRESHOLD = 0.1; // 10%
const WINDOW_SIZE = 100; // requests

function trackError(error: Error, context: any): void {
  errorCount++;
  requestCount++;
  
  const errorRate = errorCount / requestCount;
  
  if (requestCount >= WINDOW_SIZE && errorRate > ERROR_RATE_THRESHOLD) {
    // Send alert
    sendAlert({
      type: 'HIGH_ERROR_RATE',
      errorRate: errorRate * 100,
      windowSize: WINDOW_SIZE,
      context
    });
    
    // Reset counters
    errorCount = Math.floor(errorCount * 0.5);
    requestCount = Math.floor(requestCount * 0.5);
  }
}

async function sendAlert(alertData: any): Promise<void> {
  try {
    // Log to monitoring system
    console.error('🚨 ALERT:', JSON.stringify(alertData));
    
    // Could also send to external monitoring service
    // await fetch('https://monitoring-service.com/alerts', {
    //   method: 'POST',
    //   body: JSON.stringify(alertData)
    // });
  } catch (error) {
    console.error('Failed to send alert:', error);
  }
}
```

---

## 🔍 Common Issues and Solutions

### 1. Foreign Key Violations

**Issue**: Conversations can't be created due to missing user references

**Solution**:
```typescript
// Always ensure user exists before creating conversation
const userResult = await CentralizedDB.upsertUser('slack', slackUserId, userData);
if (!userResult.success) {
  // Fallback: Create minimal user
  const fallbackUser = await CentralizedDB.upsertUser('slack', slackUserId, {
    display_name: slackUserId,
    platform_metadata: { created_as_fallback: true }
  });
}
```

### 2. Duplicate Key Violations

**Issue**: Attempting to create users/conversations that already exist

**Solution**:
```sql
-- Use upsert with proper conflict resolution
INSERT INTO users (platform, platform_user_id, ...)
VALUES (...)
ON CONFLICT (platform, platform_user_id) 
DO UPDATE SET 
  display_name = COALESCE(EXCLUDED.display_name, users.display_name),
  last_seen_at = EXCLUDED.last_seen_at,
  platform_metadata = users.platform_metadata || EXCLUDED.platform_metadata;
```

### 3. Performance Issues

**Issue**: Slow queries on large conversation histories

**Solution**:
```sql
-- Add proper indexes and use pagination
CREATE INDEX CONCURRENTLY idx_conversation_timeline 
ON user_queries(conversation_id, created_at DESC);

-- Use LIMIT/OFFSET for pagination
SELECT * FROM conversation_timeline 
WHERE conversation_id = $1
ORDER BY created_at DESC
LIMIT 20 OFFSET $2;
```

### 4. Migration Data Loss

**Issue**: Some messages/reactions not migrated correctly

**Solution**:
```sql
-- Reconciliation query to find missing data
SELECT 
  'Missing queries' as issue_type,
  COUNT(*) as count
FROM messages m
LEFT JOIN user_queries uq ON m.id = uq.id
WHERE m.message_type = 'user_query' AND uq.id IS NULL

UNION ALL

SELECT 
  'Missing responses' as issue_type,
  COUNT(*) as count  
FROM messages m
LEFT JOIN bot_responses br ON m.id = br.id
WHERE m.message_type = 'bot_response' AND br.id IS NULL;

-- Re-run migration for missing items
INSERT INTO user_queries (id, conversation_id, user_id, content, ...)
SELECT m.id, m.conversation_id, c.user_id, m.content, ...
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
LEFT JOIN user_queries uq ON m.id = uq.id
WHERE m.message_type = 'user_query' AND uq.id IS NULL;
```

---

## 📞 Emergency Contact and Escalation

### Immediate Response Checklist

1. **Database Issues**:
   - Check connection status
   - Verify table existence and structure
   - Review recent migration logs
   - Consider immediate rollback if critical

2. **Application Errors**:
   - Check Edge Function logs
   - Verify environment variables
   - Test Slack webhook connectivity
   - Monitor error rates

3. **Data Integrity Issues**:
   - Run health check queries
   - Verify foreign key relationships
   - Check for orphaned records
   - Validate user→conversation mappings

4. **Performance Problems**:
   - Check query execution times
   - Monitor database connections
   - Review index usage
   - Consider read replica if available

### Escalation Path

1. **Level 1** (0-15 minutes): Automated alerts, basic troubleshooting
2. **Level 2** (15-60 minutes): Manual investigation, potential rollback
3. **Level 3** (1+ hours): Full system analysis, database recovery procedures

Remember: **Always prioritize data preservation over feature availability**. It's better to have the system temporarily unavailable than to lose conversation history or user data.