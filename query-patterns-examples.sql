-- ============================================
-- CENTRALIZED DATABASE QUERY PATTERNS & EXAMPLES
-- ============================================
-- Efficient query patterns for the new multi-platform schema
-- Including conversation history, user analytics, and performance optimization

-- ============================================
-- 1. CONVERSATION HISTORY QUERIES
-- ============================================

-- Get complete conversation history with proper ordering
-- This replaces the old single messages table approach
WITH conversation_timeline AS (
  -- Get user queries
  SELECT 
    uq.id,
    'user' as message_type,
    uq.content,
    uq.created_at,
    uq.platform_message_id,
    u.username,
    u.display_name,
    u.avatar_url,
    NULL::INTEGER as tokens_used,
    NULL::TEXT as model_used,
    NULL::INTEGER as processing_time_ms,
    NULL::JSONB as reactions
  FROM user_queries uq
  JOIN users u ON uq.user_id = u.id
  WHERE uq.conversation_id = $1 -- conversation_id parameter
  
  UNION ALL
  
  -- Get bot responses with reactions
  SELECT 
    br.id,
    'assistant' as message_type,
    br.content,
    br.created_at,
    br.platform_message_id,
    'Assistant' as username,
    'AI Assistant' as display_name,
    NULL as avatar_url,
    br.tokens_used,
    br.model_used,
    br.processing_time_ms,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'reaction_name', mr.reaction_name,
          'reaction_unicode', mr.reaction_unicode,
          'user_id', mr.user_id,
          'username', ru.username,
          'created_at', mr.created_at
        )
      ) FILTER (WHERE mr.id IS NOT NULL AND mr.removed_at IS NULL),
      '[]'::jsonb
    ) as reactions
  FROM bot_responses br
  LEFT JOIN message_reactions mr ON br.id = mr.response_id AND mr.removed_at IS NULL
  LEFT JOIN users ru ON mr.user_id = ru.id
  WHERE br.conversation_id = $1 -- conversation_id parameter
  GROUP BY br.id, br.content, br.created_at, br.platform_message_id, 
           br.tokens_used, br.model_used, br.processing_time_ms
)
SELECT *
FROM conversation_timeline
ORDER BY created_at ASC
LIMIT $2 OFFSET $3; -- pagination parameters

-- ============================================
-- 2. USER ANALYTICS QUERIES
-- ============================================

-- Get comprehensive user statistics
SELECT 
  u.id,
  u.platform,
  u.platform_user_id,
  u.display_name,
  u.first_seen_at,
  u.last_seen_at,
  
  -- Conversation stats
  COUNT(DISTINCT c.id) as total_conversations,
  COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.id END) as active_conversations,
  
  -- Message stats
  COUNT(DISTINCT uq.id) as total_queries,
  COUNT(DISTINCT br.id) as total_responses_received,
  
  -- Token usage
  COALESCE(SUM(br.tokens_used), 0) as total_tokens_consumed,
  COALESCE(AVG(br.tokens_used), 0) as avg_tokens_per_response,
  
  -- Performance stats
  COALESCE(AVG(br.processing_time_ms), 0) as avg_response_time_ms,
  
  -- Reaction stats
  COUNT(DISTINCT mr.id) as total_reactions_given,
  array_agg(DISTINCT mr.reaction_name) FILTER (WHERE mr.reaction_name IS NOT NULL) as favorite_reactions,
  
  -- Activity patterns
  DATE_TRUNC('day', u.last_seen_at) as last_active_date,
  EXTRACT(EPOCH FROM (NOW() - u.last_seen_at))/86400 as days_since_last_activity

FROM users u
LEFT JOIN conversations c ON u.id = c.user_id
LEFT JOIN user_queries uq ON u.id = uq.user_id
LEFT JOIN bot_responses br ON uq.id = br.query_id
LEFT JOIN message_reactions mr ON br.id = mr.response_id AND mr.removed_at IS NULL

WHERE u.platform = $1 -- platform filter
  AND u.created_at >= $2 -- date range filter
  AND u.is_active = true

GROUP BY u.id, u.platform, u.platform_user_id, u.display_name, 
         u.first_seen_at, u.last_seen_at
ORDER BY total_queries DESC, last_seen_at DESC;

-- ============================================
-- 3. PLATFORM COMPARISON ANALYTICS
-- ============================================

-- Compare activity across platforms
SELECT 
  platform,
  COUNT(DISTINCT u.id) as total_users,
  COUNT(DISTINCT CASE WHEN u.last_seen_at >= NOW() - INTERVAL '7 days' THEN u.id END) as weekly_active_users,
  COUNT(DISTINCT CASE WHEN u.last_seen_at >= NOW() - INTERVAL '1 day' THEN u.id END) as daily_active_users,
  
  -- Conversation metrics
  COUNT(DISTINCT c.id) as total_conversations,
  AVG(c.message_count) as avg_messages_per_conversation,
  
  -- Message volume
  COUNT(DISTINCT uq.id) as total_user_queries,
  COUNT(DISTINCT br.id) as total_bot_responses,
  
  -- AI performance
  AVG(br.tokens_used) as avg_tokens_per_response,
  AVG(br.processing_time_ms) as avg_response_time_ms,
  
  -- Error rates
  COUNT(CASE WHEN br.error_message IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(br.id), 0) as error_rate_percent,
  
  -- Engagement metrics
  COUNT(DISTINCT mr.id) as total_reactions,
  COUNT(DISTINCT mr.id) * 100.0 / NULLIF(COUNT(DISTINCT br.id), 0) as reaction_rate_percent

FROM users u
LEFT JOIN conversations c ON u.id = c.user_id
LEFT JOIN user_queries uq ON c.id = uq.conversation_id
LEFT JOIN bot_responses br ON uq.id = br.query_id
LEFT JOIN message_reactions mr ON br.id = mr.response_id AND mr.removed_at IS NULL

WHERE u.created_at >= $1 -- date range
GROUP BY platform
ORDER BY total_users DESC;

-- ============================================
-- 4. PERFORMANCE MONITORING QUERIES
-- ============================================

-- Monitor AI response performance and quality
SELECT 
  DATE_TRUNC('hour', br.created_at) as time_bucket,
  br.model_used,
  
  -- Volume metrics
  COUNT(*) as total_responses,
  COUNT(CASE WHEN br.error_message IS NOT NULL THEN 1 END) as failed_responses,
  
  -- Performance metrics
  AVG(br.processing_time_ms) as avg_processing_time_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY br.processing_time_ms) as p95_processing_time_ms,
  MAX(br.processing_time_ms) as max_processing_time_ms,
  
  -- Token usage
  AVG(br.tokens_used) as avg_tokens_used,
  SUM(br.tokens_used) as total_tokens_used,
  AVG(br.prompt_tokens) as avg_prompt_tokens,
  AVG(br.completion_tokens) as avg_completion_tokens,
  
  -- Quality indicators (reactions as proxy)
  COUNT(mr.id) as total_reactions_received,
  COUNT(CASE WHEN mr.reaction_name IN ('thumbsup', '+1', 'heart', 'fire') THEN 1 END) as positive_reactions,
  COUNT(CASE WHEN mr.reaction_name IN ('thumbsdown', '-1', 'x', 'confused') THEN 1 END) as negative_reactions

FROM bot_responses br
LEFT JOIN message_reactions mr ON br.id = mr.response_id AND mr.removed_at IS NULL

WHERE br.created_at >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', br.created_at), br.model_used
ORDER BY time_bucket DESC;

-- ============================================
-- 5. CONVERSATION CONTEXT QUERIES
-- ============================================

-- Get conversation with full context (user info, platform data, recent history)
SELECT 
  c.id as conversation_id,
  c.platform,
  c.status,
  c.is_dm,
  c.is_group_chat,
  c.channel_name,
  c.last_activity_at,
  c.message_count,
  
  -- User information
  u.id as user_id,
  u.platform_user_id,
  u.display_name,
  u.username,
  u.avatar_url,
  u.language_code,
  u.timezone,
  
  -- Platform-specific metadata
  c.platform_metadata as conversation_metadata,
  u.platform_metadata as user_metadata,
  
  -- Recent activity summary
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'content', uq.content,
        'created_at', uq.created_at,
        'response_count', (
          SELECT COUNT(*) 
          FROM bot_responses br2 
          WHERE br2.query_id = uq.id
        )
      ) ORDER BY uq.created_at DESC
    )
    FROM user_queries uq 
    WHERE uq.conversation_id = c.id 
    LIMIT 5
  ) as recent_queries,
  
  -- Statistics
  (
    SELECT jsonb_build_object(
      'avg_response_time_ms', AVG(br.processing_time_ms),
      'total_tokens_used', SUM(br.tokens_used),
      'error_count', COUNT(CASE WHEN br.error_message IS NOT NULL THEN 1 END),
      'reaction_count', (
        SELECT COUNT(*) 
        FROM message_reactions mr 
        WHERE mr.response_id = br.id 
        AND mr.removed_at IS NULL
      )
    )
    FROM bot_responses br
    WHERE br.conversation_id = c.id
  ) as conversation_stats

FROM conversations c
JOIN users u ON c.user_id = u.id
WHERE c.id = $1; -- conversation_id parameter

-- ============================================
-- 6. SEARCH AND DISCOVERY QUERIES
-- ============================================

-- Full-text search across messages with ranking
SELECT 
  c.id as conversation_id,
  c.platform,
  u.display_name as user_name,
  c.channel_name,
  
  -- Matching query
  uq.content as query_content,
  uq.created_at as query_date,
  ts_rank(to_tsvector('english', uq.content), plainto_tsquery('english', $1)) as query_rank,
  
  -- Corresponding response
  br.content as response_content,
  br.created_at as response_date,
  ts_rank(to_tsvector('english', br.content), plainto_tsquery('english', $1)) as response_rank,
  
  -- Metadata
  br.model_used,
  br.tokens_used,
  array_agg(mr.reaction_name) FILTER (WHERE mr.reaction_name IS NOT NULL) as reactions

FROM conversations c
JOIN users u ON c.user_id = u.id
JOIN user_queries uq ON c.id = uq.conversation_id
LEFT JOIN bot_responses br ON uq.id = br.query_id
LEFT JOIN message_reactions mr ON br.id = mr.response_id AND mr.removed_at IS NULL

WHERE (
  to_tsvector('english', uq.content) @@ plainto_tsquery('english', $1)
  OR to_tsvector('english', br.content) @@ plainto_tsquery('english', $1)
)
AND c.status = 'active'
AND u.platform = $2 -- platform filter

GROUP BY c.id, c.platform, u.display_name, c.channel_name,
         uq.content, uq.created_at, br.content, br.created_at,
         br.model_used, br.tokens_used

ORDER BY GREATEST(query_rank, COALESCE(response_rank, 0)) DESC
LIMIT $3; -- result limit

-- ============================================
-- 7. TRENDING AND POPULAR CONTENT
-- ============================================

-- Find most reacted-to responses (trending content)
SELECT 
  br.id as response_id,
  br.content,
  br.created_at,
  br.model_used,
  c.platform,
  u.display_name as user_name,
  
  -- Reaction statistics
  COUNT(mr.id) as total_reactions,
  COUNT(DISTINCT mr.user_id) as unique_reactors,
  array_agg(
    DISTINCT jsonb_build_object(
      'reaction_name', mr.reaction_name,
      'count', (
        SELECT COUNT(*) 
        FROM message_reactions mr2 
        WHERE mr2.response_id = br.id 
        AND mr2.reaction_name = mr.reaction_name
        AND mr2.removed_at IS NULL
      )
    )
  ) as reaction_breakdown,
  
  -- Context
  (
    SELECT uq.content 
    FROM user_queries uq 
    WHERE uq.id = br.query_id
  ) as original_query

FROM bot_responses br
JOIN conversations c ON br.conversation_id = c.id
JOIN users u ON c.user_id = u.id
JOIN message_reactions mr ON br.id = mr.response_id AND mr.removed_at IS NULL

WHERE br.created_at >= $1 -- time period
  AND br.error_message IS NULL -- only successful responses
  AND c.platform = $2 -- platform filter

GROUP BY br.id, br.content, br.created_at, br.model_used, 
         c.platform, u.display_name

HAVING COUNT(mr.id) >= $3 -- minimum reaction threshold

ORDER BY total_reactions DESC, unique_reactors DESC
LIMIT $4; -- result limit

-- ============================================
-- 8. USER ENGAGEMENT PATTERNS
-- ============================================

-- Analyze user engagement patterns and conversation flows
SELECT 
  u.id as user_id,
  u.display_name,
  u.platform,
  
  -- Basic stats
  COUNT(DISTINCT c.id) as conversation_count,
  COUNT(DISTINCT uq.id) as total_queries,
  AVG(c.message_count) as avg_messages_per_conversation,
  
  -- Temporal patterns
  EXTRACT(HOUR FROM u.last_seen_at) as preferred_hour,
  EXTRACT(DOW FROM u.last_seen_at) as preferred_day_of_week,
  
  -- Conversation types
  COUNT(CASE WHEN c.is_dm THEN 1 END) as dm_conversations,
  COUNT(CASE WHEN c.is_group_chat THEN 1 END) as group_conversations,
  COUNT(CASE WHEN c.thread_id IS NOT NULL THEN 1 END) as threaded_conversations,
  
  -- Engagement metrics
  AVG(LENGTH(uq.content)) as avg_query_length,
  COUNT(DISTINCT mr.id) as total_reactions_given,
  COUNT(DISTINCT mr.reaction_name) as unique_reactions_used,
  
  -- Session patterns
  COUNT(DISTINCT DATE(uq.created_at)) as active_days,
  AVG(
    EXTRACT(EPOCH FROM (
      LAG(uq.created_at) OVER (PARTITION BY u.id ORDER BY uq.created_at DESC) - uq.created_at
    ))/60
  ) as avg_minutes_between_messages,
  
  -- Platform-specific usage
  (u.platform_metadata->>'team_id')::text as slack_team,
  CASE 
    WHEN u.platform_metadata->>'is_admin' = 'true' THEN true 
    ELSE false 
  END as is_admin_user

FROM users u
JOIN conversations c ON u.id = c.user_id
LEFT JOIN user_queries uq ON u.id = uq.user_id
LEFT JOIN bot_responses br ON uq.id = br.query_id
LEFT JOIN message_reactions mr ON br.id = mr.response_id AND mr.removed_at IS NULL

WHERE u.platform = $1 -- platform filter
  AND u.last_seen_at >= $2 -- activity threshold

GROUP BY u.id, u.display_name, u.platform, u.last_seen_at, u.platform_metadata

HAVING COUNT(DISTINCT uq.id) >= $3 -- minimum activity threshold

ORDER BY total_queries DESC, conversation_count DESC;

-- ============================================
-- 9. ERROR ANALYSIS AND DEBUGGING
-- ============================================

-- Analyze errors and failed responses for debugging
SELECT 
  DATE_TRUNC('day', br.created_at) as error_date,
  br.error_code,
  br.error_message,
  br.model_used,
  c.platform,
  
  -- Error frequency
  COUNT(*) as error_count,
  COUNT(DISTINCT br.conversation_id) as affected_conversations,
  COUNT(DISTINCT c.user_id) as affected_users,
  
  -- Context
  AVG(br.retry_count) as avg_retry_count,
  AVG(LENGTH(uq.content)) as avg_query_length,
  
  -- Recovery stats
  COUNT(CASE WHEN retry_br.id IS NOT NULL THEN 1 END) as successful_retries,
  
  -- Sample errors for investigation
  array_agg(
    DISTINCT jsonb_build_object(
      'conversation_id', br.conversation_id,
      'query_content', LEFT(uq.content, 100),
      'processing_time_ms', br.processing_time_ms,
      'created_at', br.created_at
    )
  ) FILTER (WHERE br.id IS NOT NULL) as sample_errors

FROM bot_responses br
JOIN conversations c ON br.conversation_id = c.id
JOIN user_queries uq ON br.query_id = uq.id
LEFT JOIN bot_responses retry_br ON (
  retry_br.conversation_id = br.conversation_id 
  AND retry_br.created_at > br.created_at
  AND retry_br.error_message IS NULL
  AND retry_br.created_at <= br.created_at + INTERVAL '5 minutes'
)

WHERE br.error_message IS NOT NULL
  AND br.created_at >= $1 -- date range

GROUP BY DATE_TRUNC('day', br.created_at), br.error_code, 
         br.error_message, br.model_used, c.platform

ORDER BY error_date DESC, error_count DESC;

-- ============================================
-- 10. PERFORMANCE OPTIMIZATION INDEXES
-- ============================================

-- Recommended indexes for optimal query performance
-- (These should be created separately, included here for reference)

/*
-- Conversation history queries
CREATE INDEX CONCURRENTLY idx_user_queries_conversation_created_desc 
ON user_queries(conversation_id, created_at DESC);

CREATE INDEX CONCURRENTLY idx_bot_responses_conversation_created_desc 
ON bot_responses(conversation_id, created_at DESC);

-- User analytics
CREATE INDEX CONCURRENTLY idx_users_platform_active_last_seen 
ON users(platform, is_active, last_seen_at DESC) WHERE is_active = true;

-- Search functionality
CREATE INDEX CONCURRENTLY idx_user_queries_content_gin 
ON user_queries USING gin(to_tsvector('english', content));

CREATE INDEX CONCURRENTLY idx_bot_responses_content_gin 
ON bot_responses USING gin(to_tsvector('english', content));

-- Platform message ID lookups
CREATE INDEX CONCURRENTLY idx_bot_responses_platform_message_id 
ON bot_responses(platform_message_id) WHERE platform_message_id IS NOT NULL;

-- Reaction queries
CREATE INDEX CONCURRENTLY idx_message_reactions_response_active 
ON message_reactions(response_id) WHERE removed_at IS NULL;

-- Error monitoring
CREATE INDEX CONCURRENTLY idx_bot_responses_error_created 
ON bot_responses(created_at DESC) WHERE error_message IS NOT NULL;

-- Time-based analytics
CREATE INDEX CONCURRENTLY idx_conversations_platform_created 
ON conversations(platform, created_at DESC);

CREATE INDEX CONCURRENTLY idx_user_queries_created_date 
ON user_queries(DATE(created_at), created_at DESC);
*/