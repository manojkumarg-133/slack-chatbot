# ✅ Migration Testing & Verification Checklist
## Centralized Database Migration Validation

This comprehensive checklist ensures your migration from the old Slack bot schema to the new centralized multi-platform schema maintains data integrity and functionality.

---

## 📋 Pre-Migration Testing

### 1. Environment Preparation

- [ ] **Database Backup Completed**
  ```bash
  # Verify backup exists and is valid
  ls -la backup_*.sql
  pg_dump --version
  ```

- [ ] **Test Environment Setup**
  - [ ] Separate test database created
  - [ ] Test environment variables configured
  - [ ] Test Slack workspace configured
  - [ ] Supabase test project ready

- [ ] **Dependency Verification**
  ```bash
  # Check all required tools are installed
  deno --version
  supabase --version
  psql --version
  ```

- [ ] **Code Compilation Check**
  ```bash
  # Verify TypeScript compilation
  deno check src/types/centralized-database.types.ts
  deno check supabase/functions/_shared/centralized-database.ts
  ```

---

## 🔄 Migration Process Testing

### 2. Schema Migration Validation

- [ ] **New Schema Creation**
  ```sql
  -- Verify all tables exist with correct structure
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns 
  WHERE table_name IN ('users', 'conversations', 'user_queries', 'bot_responses', 'message_reactions', 'platform_configs')
  ORDER BY table_name, ordinal_position;
  ```

- [ ] **Enum Types Created**
  ```sql
  -- Check enum types
  SELECT typname FROM pg_type WHERE typtype = 'e';
  -- Should include: platform_type, conversation_status, message_status
  ```

- [ ] **Indexes Created**
  ```sql
  -- Verify critical indexes exist
  SELECT indexname, tablename FROM pg_indexes 
  WHERE tablename IN ('users', 'conversations', 'user_queries', 'bot_responses', 'message_reactions')
  ORDER BY tablename;
  ```

- [ ] **Triggers and Functions**
  ```sql
  -- Check triggers are active
  SELECT trigger_name, table_name, action_timing, event_manipulation
  FROM information_schema.triggers
  WHERE table_name IN ('users', 'conversations', 'bot_responses', 'user_queries');
  ```

### 3. Data Migration Validation

- [ ] **User Migration Verification**
  ```sql
  -- Test user migration completeness
  SELECT 
    'Original reactions' as source,
    COUNT(DISTINCT slack_user_id) as unique_users
  FROM message_reactions
  UNION ALL
  SELECT 
    'Migrated users' as source,
    COUNT(*) as unique_users
  FROM users WHERE platform = 'slack';
  
  -- Should have similar counts
  ```

- [ ] **Conversation Migration Check**
  ```sql
  -- Verify conversation mapping
  SELECT 
    c_old.id as old_conversation_id,
    c_new.id as new_conversation_id,
    c_new.user_id,
    u.platform_user_id,
    c_new.message_count,
    (SELECT COUNT(*) FROM messages WHERE conversation_id = c_old.id) as original_message_count
  FROM conversations c_old
  JOIN conversations c_new ON c_old.id = c_new.id
  LEFT JOIN users u ON c_new.user_id = u.id
  LIMIT 10;
  ```

- [ ] **Message Split Verification**
  ```sql
  -- Verify queries and responses were split correctly
  SELECT 
    'Original messages' as type,
    message_type,
    COUNT(*) as count
  FROM messages 
  GROUP BY message_type
  UNION ALL
  SELECT 'User queries', 'user_query', COUNT(*) FROM user_queries
  UNION ALL
  SELECT 'Bot responses', 'bot_response', COUNT(*) FROM bot_responses;
  ```

- [ ] **Reaction Migration Check**
  ```sql
  -- Verify reactions were migrated
  SELECT 
    COUNT(*) as old_reactions,
    (SELECT COUNT(*) FROM message_reactions WHERE removed_at IS NULL) as new_reactions,
    COUNT(*) - (SELECT COUNT(*) FROM message_reactions WHERE removed_at IS NULL) as difference
  FROM (SELECT * FROM message_reactions) old_reactions;
  ```

---

## 🧪 Functionality Testing

### 4. Database Helper Function Tests

- [ ] **User Management Functions**
  ```typescript
  // Test user creation
  const userResult = await CentralizedDB.upsertUser('slack', 'TEST_USER_123', {
    display_name: 'Test User',
    username: 'testuser'
  });
  console.assert(userResult.success, 'User creation failed');
  
  // Test user retrieval
  const getUserResult = await CentralizedDB.getUser('slack', 'TEST_USER_123');
  console.assert(getUserResult.success && getUserResult.user, 'User retrieval failed');
  
  // Test duplicate handling
  const duplicateResult = await CentralizedDB.upsertUser('slack', 'TEST_USER_123', {
    display_name: 'Updated Test User'
  });
  console.assert(duplicateResult.success, 'Duplicate user handling failed');
  ```

- [ ] **Conversation Management**
  ```typescript
  // Test conversation creation
  const convResult = await CentralizedDB.getOrCreateConversation(
    'slack',
    userResult.user!.id,
    'C12345TEST',
    undefined,
    {
      channel_name: 'test-channel',
      is_dm: false
    }
  );
  console.assert(convResult.success, 'Conversation creation failed');
  
  // Test conversation continuity
  const conv2Result = await CentralizedDB.getOrCreateConversation(
    'slack',
    userResult.user!.id,
    'C12345TEST'
  );
  console.assert(conv2Result.conversation!.id === convResult.conversation!.id, 
    'Conversation continuity failed');
  ```

- [ ] **Message Handling**
  ```typescript
  // Test user query saving
  const queryResult = await CentralizedDB.saveUserQuery(
    convResult.conversation!.id,
    userResult.user!.id,
    'Test message content',
    '1234567890.123456'
  );
  console.assert(queryResult.success, 'User query saving failed');
  
  // Test bot response saving
  const responseResult = await CentralizedDB.saveBotResponse(
    queryResult.query!.id,
    convResult.conversation!.id,
    'Test bot response',
    {
      modelUsed: 'test-model',
      tokensUsed: 50,
      processingTimeMs: 1000
    }
  );
  console.assert(responseResult.success, 'Bot response saving failed');
  ```

- [ ] **Reaction Handling**
  ```typescript
  // Test reaction addition
  const reactionResult = await CentralizedDB.addMessageReaction(
    responseResult.response!.id,
    userResult.user!.id,
    'thumbsup',
    'slack'
  );
  console.assert(reactionResult.success, 'Reaction addition failed');
  
  // Test reaction removal
  const removeResult = await CentralizedDB.removeMessageReaction(
    responseResult.response!.id,
    userResult.user!.id,
    'thumbsup'
  );
  console.assert(removeResult.success, 'Reaction removal failed');
  ```

### 5. Edge Function Testing

- [ ] **Slack Event Processing**
  ```typescript
  // Test app mention handling
  const mockMentionEvent = {
    type: 'app_mention',
    user: 'U12345TEST',
    text: '<@U67890BOT> Hello test',
    channel: 'C12345TEST',
    ts: '1234567890.123456'
  };
  
  // This should be tested in a controlled environment
  await processSlackEvent(mockMentionEvent, 'T12345TEST');
  ```

- [ ] **Error Handling**
  ```typescript
  // Test with invalid user
  const invalidEvent = {
    type: 'app_mention',
    user: null, // Invalid user
    text: 'Test message',
    channel: 'C12345TEST',
    ts: '1234567890.123456'
  };
  
  // Should handle gracefully without throwing
  await processSlackEvent(invalidEvent, 'T12345TEST');
  ```

### 6. Query Performance Testing

- [ ] **Conversation History Performance**
  ```sql
  -- Test conversation history query performance
  EXPLAIN (ANALYZE, BUFFERS) 
  WITH conversation_timeline AS (
    -- Your conversation history query here
  )
  SELECT * FROM conversation_timeline 
  WHERE conversation_id = 'test-conversation-id'
  ORDER BY created_at ASC;
  
  -- Execution time should be < 100ms for typical conversations
  ```

- [ ] **User Analytics Performance**
  ```sql
  -- Test user stats query
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT u.*, COUNT(DISTINCT c.id) as conversation_count
  FROM users u
  LEFT JOIN conversations c ON u.id = c.user_id
  WHERE u.platform = 'slack'
  GROUP BY u.id
  LIMIT 100;
  ```

---

## 🔍 Data Integrity Testing

### 7. Foreign Key Integrity

- [ ] **User-Conversation Relationships**
  ```sql
  -- Check for orphaned conversations
  SELECT COUNT(*) as orphaned_conversations
  FROM conversations c
  LEFT JOIN users u ON c.user_id = u.id
  WHERE u.id IS NULL;
  -- Should be 0
  ```

- [ ] **Query-Response Relationships**
  ```sql
  -- Check for orphaned responses
  SELECT COUNT(*) as orphaned_responses
  FROM bot_responses br
  LEFT JOIN user_queries uq ON br.query_id = uq.id
  WHERE uq.id IS NULL;
  -- Should be 0
  ```

- [ ] **Reaction Relationships**
  ```sql
  -- Check for orphaned reactions
  SELECT COUNT(*) as orphaned_reactions
  FROM message_reactions mr
  LEFT JOIN bot_responses br ON mr.response_id = br.id
  LEFT JOIN users u ON mr.user_id = u.id
  WHERE br.id IS NULL OR u.id IS NULL;
  -- Should be 0
  ```

### 8. Data Consistency Checks

- [ ] **Platform Consistency**
  ```sql
  -- Verify platform consistency across related records
  SELECT DISTINCT
    u.platform as user_platform,
    c.platform as conversation_platform,
    mr.platform as reaction_platform
  FROM users u
  JOIN conversations c ON u.id = c.user_id
  JOIN user_queries uq ON c.id = uq.conversation_id
  JOIN bot_responses br ON uq.id = br.query_id
  JOIN message_reactions mr ON br.id = mr.response_id
  WHERE u.platform != c.platform OR u.platform != mr.platform;
  -- Should return no rows
  ```

- [ ] **Message Count Accuracy**
  ```sql
  -- Verify conversation message counts are accurate
  SELECT 
    c.id,
    c.message_count,
    (
      (SELECT COUNT(*) FROM user_queries WHERE conversation_id = c.id) +
      (SELECT COUNT(*) FROM bot_responses WHERE conversation_id = c.id)
    ) as actual_count,
    c.message_count - (
      (SELECT COUNT(*) FROM user_queries WHERE conversation_id = c.id) +
      (SELECT COUNT(*) FROM bot_responses WHERE conversation_id = c.id)
    ) as difference
  FROM conversations c
  WHERE ABS(c.message_count - (
    (SELECT COUNT(*) FROM user_queries WHERE conversation_id = c.id) +
    (SELECT COUNT(*) FROM bot_responses WHERE conversation_id = c.id)
  )) > 0
  LIMIT 10;
  -- Should return no rows or minimal differences
  ```

### 9. Metadata Validation

- [ ] **Platform Metadata Structure**
  ```sql
  -- Check Slack metadata structure
  SELECT 
    platform_metadata->'team_id' as team_id,
    platform_metadata->'is_admin' as is_admin
  FROM users 
  WHERE platform = 'slack'
  AND (
    platform_metadata->'team_id' IS NULL OR
    NOT (platform_metadata ? 'team_id')
  )
  LIMIT 5;
  -- Should have valid team_id for Slack users
  ```

- [ ] **Required Fields Validation**
  ```sql
  -- Check for required fields
  SELECT 'users' as table_name, COUNT(*) as null_count
  FROM users WHERE platform_user_id IS NULL OR platform IS NULL
  UNION ALL
  SELECT 'conversations', COUNT(*)
  FROM conversations WHERE user_id IS NULL OR platform IS NULL
  UNION ALL
  SELECT 'user_queries', COUNT(*)
  FROM user_queries WHERE conversation_id IS NULL OR user_id IS NULL OR content IS NULL;
  -- All counts should be 0
  ```

---

## 🚀 End-to-End Testing

### 10. Complete Workflow Testing

- [ ] **Slack Message Flow**
  1. **Setup Test Environment**
     ```bash
     # Deploy new Edge Function
     supabase functions deploy slack-events-centralized
     ```
  
  2. **Send Test Message**
     - Send @mention in test Slack channel
     - Verify user is created/updated in database
     - Verify conversation is created/continued
     - Verify user query is saved
     - Verify bot response is generated and saved
     - Verify response appears in Slack

  3. **Add Reaction Test**
     - Add reaction to bot response in Slack
     - Verify reaction is saved in database
     - Verify reaction response (if enabled)

  4. **Thread Conversation Test**
     - Start thread conversation
     - Verify separate conversation record
     - Verify thread continuity

### 11. Performance and Load Testing

- [ ] **Concurrent Message Handling**
  ```bash
  # Simulate multiple concurrent messages
  for i in {1..10}; do
    curl -X POST "${SUPABASE_URL}/functions/v1/slack-events-centralized" \
      -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
      -d "@test-event-${i}.json" &
  done
  wait
  ```

- [ ] **Database Connection Limits**
  - Monitor active connections during load test
  - Verify connection pooling works correctly
  - Check for connection leaks

- [ ] **Response Time Benchmarks**
  - App mention response: < 3 seconds
  - DM response: < 3 seconds  
  - Reaction handling: < 1 second
  - Database queries: < 100ms average

### 12. Error Scenario Testing

- [ ] **Database Connectivity Issues**
  ```typescript
  // Test with invalid database credentials
  const invalidSupabase = createClient('invalid-url', 'invalid-key');
  // Should handle gracefully without crashing
  ```

- [ ] **Malformed Slack Events**
  ```json
  // Test with missing required fields
  {
    "type": "event_callback",
    "event": {
      "type": "app_mention"
      // Missing user, channel, text, ts
    }
  }
  ```

- [ ] **AI Service Failures**
  - Test with AI service timeout
  - Test with invalid API responses
  - Verify error messages are user-friendly

---

## 📊 Migration Validation Report

### 13. Generate Migration Report

```sql
-- Create comprehensive migration validation report
SELECT 
  'Migration Summary' as report_section,
  json_build_object(
    'migration_date', NOW(),
    'users_migrated', (SELECT COUNT(*) FROM users WHERE platform = 'slack'),
    'conversations_migrated', (SELECT COUNT(*) FROM conversations),
    'queries_migrated', (SELECT COUNT(*) FROM user_queries),
    'responses_migrated', (SELECT COUNT(*) FROM bot_responses),
    'reactions_migrated', (SELECT COUNT(*) FROM message_reactions WHERE removed_at IS NULL),
    'orphaned_conversations', (
      SELECT COUNT(*) FROM conversations c 
      LEFT JOIN users u ON c.user_id = u.id 
      WHERE u.id IS NULL
    ),
    'data_integrity_score', (
      SELECT 
        CASE 
          WHEN COUNT(CASE WHEN u.id IS NULL THEN 1 END) = 0 THEN 100
          ELSE 100 - (COUNT(CASE WHEN u.id IS NULL THEN 1 END) * 100.0 / COUNT(*))
        END
      FROM conversations c
      LEFT JOIN users u ON c.user_id = u.id
    )
  ) as report_data

UNION ALL

SELECT 
  'Performance Metrics',
  json_build_object(
    'avg_response_time_ms', (
      SELECT AVG(processing_time_ms) 
      FROM bot_responses 
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    ),
    'error_rate_percent', (
      SELECT 
        COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END) * 100.0 / 
        NULLIF(COUNT(*), 0)
      FROM bot_responses 
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    ),
    'total_tokens_used', (
      SELECT SUM(tokens_used) 
      FROM bot_responses 
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    )
  )

UNION ALL

SELECT 
  'Quality Indicators',
  json_build_object(
    'reaction_rate_percent', (
      SELECT 
        COUNT(DISTINCT mr.response_id) * 100.0 / NULLIF(COUNT(DISTINCT br.id), 0)
      FROM bot_responses br
      LEFT JOIN message_reactions mr ON br.id = mr.response_id AND mr.removed_at IS NULL
      WHERE br.created_at >= NOW() - INTERVAL '7 days'
    ),
    'user_engagement_score', (
      SELECT AVG(message_count) FROM conversations WHERE status = 'active'
    ),
    'platform_coverage', (
      SELECT COUNT(DISTINCT platform) FROM users
    )
  );
```

---

## ✅ Final Checklist

### 14. Go-Live Readiness

- [ ] **All automated tests passing**
- [ ] **Manual testing scenarios completed**
- [ ] **Performance benchmarks met**
- [ ] **Error handling verified**
- [ ] **Rollback procedure tested**
- [ ] **Monitoring and alerting configured**
- [ ] **Documentation updated**
- [ ] **Team trained on new system**

### 15. Post-Migration Monitoring

- [ ] **24-hour monitoring period scheduled**
- [ ] **Error rates below baseline**
- [ ] **Response times within SLA**
- [ ] **User feedback collected**
- [ ] **Data integrity maintained**

### 16. Success Criteria Met

- [ ] **✅ All existing Slack conversations preserved and accessible**
- [ ] **✅ All existing messages correctly split into queries and responses**
- [ ] **✅ All reactions properly linked to users and responses**  
- [ ] **✅ New messages work seamlessly with new schema**
- [ ] **✅ Code is clean, modular, and well-documented**
- [ ] **✅ No data lost during migration**
- [ ] **✅ Performance equal to or better than before**
- [ ] **✅ Ready for multi-platform expansion**

---

## 🎉 Migration Complete!

When all checklist items are verified and passing, your migration to the centralized database schema is complete and ready for production use.

**Next Steps:**
1. Monitor system for 48 hours
2. Collect user feedback  
3. Plan next platform integration (Discord, WhatsApp, etc.)
4. Archive old schema tables after 30 days of stable operation

**Remember:** Keep this checklist and test results for future reference and for onboarding new team members to the centralized system.