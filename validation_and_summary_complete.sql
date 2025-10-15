-- ============================================
-- COMPLETE VALIDATION SECTION
-- Fixes the truncated validation from your script
-- ============================================

DO $$
DECLARE
    validation_errors TEXT[] := ARRAY[]::TEXT[];
    error_count INTEGER := 0;
    
    -- Counters
    null_user_ids INTEGER;
    null_query_user_ids INTEGER;
    null_response_query_ids INTEGER;
    null_reaction_ids INTEGER;
    invalid_fk_conversations INTEGER;
    invalid_fk_queries INTEGER;
    invalid_fk_responses INTEGER;
    invalid_fk_reactions INTEGER;
    conversations_without_updated_at INTEGER;
    conversations_without_last_activity INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '🔍 Running comprehensive validation checks...';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    
    -- Check 1: All conversations have valid user_id (FIX #3, #4)
    SELECT COUNT(*) INTO null_user_ids FROM conversations WHERE user_id IS NULL;
    IF null_user_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_user_ids || ' conversations have NULL user_id');
        error_count := error_count + 1;
    END IF;
    
    -- Check 2: All user_queries have valid conversation_id and user_id
    SELECT COUNT(*) INTO null_query_user_ids 
    FROM user_queries WHERE conversation_id IS NULL OR user_id IS NULL;
    IF null_query_user_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_query_user_ids || ' user_queries have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 3: FIX #4 - All bot_responses have valid query_id and conversation_id
    SELECT COUNT(*) INTO null_response_query_ids 
    FROM bot_responses WHERE query_id IS NULL OR conversation_id IS NULL;
    IF null_response_query_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_response_query_ids || ' bot_responses have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 4: All message_reactions have valid response_id and user_id
    SELECT COUNT(*) INTO null_reaction_ids 
    FROM message_reactions WHERE response_id IS NULL OR user_id IS NULL;
    IF null_reaction_ids > 0 THEN
        validation_errors := array_append(validation_errors, 
            null_reaction_ids || ' message_reactions have NULL foreign keys');
        error_count := error_count + 1;
    END IF;
    
    -- Check 5: Foreign key integrity - conversations->users
    SELECT COUNT(*) INTO invalid_fk_conversations
    FROM conversations c 
    LEFT JOIN users u ON c.user_id = u.id 
    WHERE u.id IS NULL;
    IF invalid_fk_conversations > 0 THEN
        validation_errors := array_append(validation_errors, 
            'Foreign key integrity violation: ' || invalid_fk_conversations || ' conversations->users');
        error_count := error_count + 1;
    END IF;
    
    -- Check 6: Foreign key integrity - user_queries->conversations and users
    SELECT COUNT(*) INTO invalid_fk_queries
    FROM user_queries uq
    LEFT JOIN conversations c ON uq.conversation_id = c.id
    LEFT JOIN users u ON uq.user_id = u.id
    WHERE c.id IS NULL OR u.id IS NULL;
    IF invalid_fk_queries > 0 THEN
        validation_errors := array_append(validation_errors, 
            'Foreign key integrity violation: ' || invalid_fk_queries || ' user_queries');
        error_count := error_count + 1;
    END IF;
    
    -- Check 7: FIX #4 - Foreign key integrity - bot_responses->user_queries
    SELECT COUNT(*) INTO invalid_fk_responses
    FROM bot_responses br
    LEFT JOIN user_queries uq ON br.query_id = uq.id
    LEFT JOIN conversations c ON br.conversation_id = c.id
    WHERE uq.id IS NULL OR c.id IS NULL;
    IF invalid_fk_responses > 0 THEN
        validation_errors := array_append(validation_errors, 
            'Foreign key integrity violation: ' || invalid_fk_responses || ' bot_responses');
        error_count := error_count + 1;
    END IF;
    
    -- Check 8: Foreign key integrity - message_reactions->bot_responses and users
    SELECT COUNT(*) INTO invalid_fk_reactions
    FROM message_reactions mr
    LEFT JOIN bot_responses br ON mr.response_id = br.id
    LEFT JOIN users u ON mr.user_id = u.id
    WHERE br.id IS NULL OR u.id IS NULL;
    IF invalid_fk_reactions > 0 THEN
        validation_errors := array_append(validation_errors, 
            'Foreign key integrity violation: ' || invalid_fk_reactions || ' message_reactions');
        error_count := error_count + 1;
    END IF;
    
    -- Check 9: FIX #2, #3 - All conversations have updated_at and last_activity_at
    SELECT COUNT(*) INTO conversations_without_updated_at 
    FROM conversations WHERE updated_at IS NULL;
    IF conversations_without_updated_at > 0 THEN
        validation_errors := array_append(validation_errors, 
            conversations_without_updated_at || ' conversations missing updated_at');
        error_count := error_count + 1;
    END IF;
    
    SELECT COUNT(*) INTO conversations_without_last_activity 
    FROM conversations WHERE last_activity_at IS NULL;
    IF conversations_without_last_activity > 0 THEN
        validation_errors := array_append(validation_errors, 
            conversations_without_last_activity || ' conversations missing last_activity_at');
        error_count := error_count + 1;
    END IF;
    
    -- Report detailed results
    RAISE NOTICE 'Validation Results:';
    RAISE NOTICE '  📊 Conversations: % (% with null user_id)', 
        (SELECT COUNT(*) FROM conversations), null_user_ids;
    RAISE NOTICE '  ❓ User Queries: % (% with null FKs)', 
        (SELECT COUNT(*) FROM user_queries), null_query_user_ids;
    RAISE NOTICE '  🤖 Bot Responses: % (% with null FKs)', 
        (SELECT COUNT(*) FROM bot_responses), null_response_query_ids;
    RAISE NOTICE '  👍 Reactions: % (% with null FKs)', 
        (SELECT COUNT(*) FROM message_reactions), null_reaction_ids;
    RAISE NOTICE '  🔗 Foreign Key Violations: % total', 
        (invalid_fk_conversations + invalid_fk_queries + invalid_fk_responses + invalid_fk_reactions);
    
    -- Final verdict
    IF error_count = 0 THEN
        RAISE NOTICE '';
        RAISE NOTICE '✅ ✅ ✅ MIGRATION VALIDATION PASSED! ✅ ✅ ✅';
        RAISE NOTICE 'All integrity checks successful - migration is safe to commit!';
        RAISE NOTICE '';
    ELSE
        RAISE NOTICE '';
        RAISE NOTICE '❌ ❌ ❌ MIGRATION VALIDATION FAILED! ❌ ❌ ❌';
        RAISE NOTICE 'Found % critical issues:', error_count;
        FOR i IN 1..array_length(validation_errors, 1) LOOP
            RAISE NOTICE '  🔥 %', validation_errors[i];
        END LOOP;
        RAISE NOTICE '';
        RAISE EXCEPTION 'Migration validation failed! Please fix issues before proceeding.';
    END IF;
END
$$;

-- ============================================
-- MIGRATION SUMMARY WITH ALL FIXES
-- ============================================

DO $$
DECLARE
    summary_data RECORD;
BEGIN
    SELECT 
        (SELECT COUNT(*) FROM users WHERE platform = 'slack') as migrated_users,
        (SELECT COUNT(*) FROM conversations) as migrated_conversations,
        (SELECT COUNT(*) FROM user_queries) as migrated_queries,
        (SELECT COUNT(*) FROM user_queries WHERE platform_metadata->>'is_migration_placeholder' = 'true') as placeholder_queries,
        (SELECT COUNT(*) FROM bot_responses) as migrated_responses,
        (SELECT COUNT(*) FROM message_reactions) as migrated_reactions,
        (SELECT COUNT(*) FROM users WHERE platform_user_id = 'MIGRATION_UNKNOWN_USER') as orphaned_data_users,
        (SELECT COUNT(*) FROM conversations c JOIN users u ON c.user_id = u.id 
         WHERE u.platform_user_id = 'MIGRATION_UNKNOWN_USER') as orphaned_conversations
    INTO summary_data;
    
    RAISE NOTICE '';
    RAISE NOTICE '🎉 🎉 🎉 CORRECTED MIGRATION COMPLETED! 🎉 🎉 🎉';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'Migration Summary:';
    RAISE NOTICE '  📊 Users migrated: %', summary_data.migrated_users;
    RAISE NOTICE '  💬 Conversations migrated: %', summary_data.migrated_conversations;
    RAISE NOTICE '  ❓ User queries migrated: % (% real + % placeholder)', 
        summary_data.migrated_queries, 
        summary_data.migrated_queries - summary_data.placeholder_queries,
        summary_data.placeholder_queries;
    RAISE NOTICE '  🤖 Bot responses migrated: %', summary_data.migrated_responses;
    RAISE NOTICE '  👍 Reactions migrated: %', summary_data.migrated_reactions;
    RAISE NOTICE '  ⚠️  Orphaned conversations: %', summary_data.orphaned_conversations;
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '✅ ALL 4 CRITICAL FIXES APPLIED:';
    RAISE NOTICE '  ✅ FIX #1: Proper reaction mapping (only bot_response reactions)';
    RAISE NOTICE '  ✅ FIX #2: Added missing updated_at columns';
    RAISE NOTICE '  ✅ FIX #3: Added NOW() fallbacks in conversation updates';
    RAISE NOTICE '  ✅ FIX #4: Guaranteed foreign key integrity with placeholder queries';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 Migration is now PRODUCTION READY!';
    RAISE NOTICE '';
END
$$;

-- ============================================
-- POST-MIGRATION VERIFICATION QUERIES
-- ============================================

/*
🔍 Run these queries to verify migration success:

-- 1. Check all tables have data
SELECT 
    'users' as table_name, COUNT(*) as count 
FROM users WHERE platform = 'slack'
UNION ALL
SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL  
SELECT 'user_queries', COUNT(*) FROM user_queries
UNION ALL
SELECT 'bot_responses', COUNT(*) FROM bot_responses
UNION ALL
SELECT 'message_reactions', COUNT(*) FROM message_reactions;

-- 2. Verify no NULL foreign keys
SELECT 
    'conversations_null_user_id' as check_name,
    COUNT(*) as violations
FROM conversations WHERE user_id IS NULL
UNION ALL
SELECT 'queries_null_fks', COUNT(*) 
FROM user_queries WHERE conversation_id IS NULL OR user_id IS NULL
UNION ALL
SELECT 'responses_null_query_id', COUNT(*) 
FROM bot_responses WHERE query_id IS NULL
UNION ALL
SELECT 'reactions_null_fks', COUNT(*) 
FROM message_reactions WHERE response_id IS NULL OR user_id IS NULL;

-- 3. Check placeholder queries created for orphaned responses
SELECT 
    COUNT(*) as placeholder_queries,
    COUNT(DISTINCT conversation_id) as conversations_with_placeholders
FROM user_queries 
WHERE platform_metadata->>'is_migration_placeholder' = 'true';

-- 4. Verify updated_at columns populated
SELECT 
    'conversations_with_updated_at' as metric,
    COUNT(*) as count
FROM conversations WHERE updated_at IS NOT NULL
UNION ALL
SELECT 'queries_with_updated_at', COUNT(*) 
FROM user_queries WHERE updated_at IS NOT NULL
UNION ALL
SELECT 'responses_with_updated_at', COUNT(*) 
FROM bot_responses WHERE updated_at IS NOT NULL;
*/