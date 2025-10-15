// ============================================
// CENTRALIZED MULTI-PLATFORM DATABASE TYPES
// Supports: Slack, Discord, WhatsApp, Telegram, Twitch
// ============================================

// ============================================
// ENUM TYPES
// ============================================

export type PlatformType = 'slack' | 'discord' | 'whatsapp' | 'telegram' | 'twitch';
export type ConversationStatus = 'active' | 'archived' | 'deleted';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

// ============================================
// PLATFORM METADATA TYPES
// ============================================

// Slack-specific metadata
export interface SlackUserMetadata {
  team_id: string;
  enterprise_id?: string;
  is_enterprise_install?: boolean;
  is_admin?: boolean;
  is_owner?: boolean;
  is_primary_owner?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_stranger?: boolean;
  is_app_user?: boolean;
  has_2fa?: boolean;
  locale?: string;
  tz?: string;
  tz_label?: string;
  tz_offset?: number;
}

export interface SlackConversationMetadata {
  team: string;
  channel_type: 'public_channel' | 'private_channel' | 'im' | 'mpim';
  is_archived?: boolean;
  is_general?: boolean;
  is_starred?: boolean;
  is_member?: boolean;
  topic?: string;
  purpose?: string;
  num_members?: number;
  previous_names?: string[];
}

export interface SlackMessageMetadata {
  client_msg_id?: string;
  team: string;
  blocks?: any[]; // Slack Block Kit data
  thread_ts?: string;
  parent_user_id?: string;
  permalink?: string;
  edited?: {
    user: string;
    ts: string;
  };
}

// Generic platform metadata (can be extended for other platforms)
export type PlatformMetadata = 
  | SlackUserMetadata 
  | SlackConversationMetadata 
  | SlackMessageMetadata 
  | Record<string, any>;

// ============================================
// TABLE INTERFACES
// ============================================

export interface User {
  id: string;
  platform: PlatformType;
  platform_user_id: string;
  username?: string | null;
  display_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  avatar_url?: string | null;
  language_code: string;
  timezone?: string | null;
  is_bot: boolean;
  is_active: boolean;
  notifications_enabled: boolean;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  platform_metadata: PlatformMetadata;
}

export interface Conversation {
  id: string;
  platform: PlatformType;
  user_id: string;
  channel_id?: string | null;
  channel_name?: string | null;
  thread_id?: string | null;
  is_group_chat: boolean;
  is_dm: boolean;
  status: ConversationStatus;
  title?: string | null;
  last_activity_at: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  platform_metadata: PlatformMetadata;
}

export interface UserQuery {
  id: string;
  conversation_id: string;
  user_id: string;
  content: string;
  platform_message_id?: string | null;
  has_attachments: boolean;
  attachment_urls?: string[] | null;
  message_type: string;
  status: MessageStatus;
  created_at: string;
  platform_metadata: PlatformMetadata;
}

export interface BotResponse {
  id: string;
  query_id: string;
  conversation_id: string;
  content: string;
  platform_message_id?: string | null;
  model_used: string;
  tokens_used?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  processing_time_ms?: number | null;
  has_attachments: boolean;
  attachment_urls?: string[] | null;
  response_type: string;
  error_message?: string | null;
  error_code?: string | null;
  retry_count: number;
  status: MessageStatus;
  created_at: string;
  platform_metadata: PlatformMetadata;
}

export interface MessageReaction {
  id: string;
  response_id: string;
  user_id: string;
  reaction_name: string;
  reaction_unicode?: string | null;
  platform: PlatformType;
  created_at: string;
  removed_at?: string | null;
}

export interface PlatformConfig {
  id: string;
  platform: PlatformType;
  is_enabled: boolean;
  webhook_url?: string | null;
  api_base_url?: string | null;
  rate_limit_per_minute: number;
  rate_limit_per_hour: number;
  supports_threads: boolean;
  supports_reactions: boolean;
  supports_attachments: boolean;
  supports_rich_media: boolean;
  config_data: Record<string, any>;
  created_at: string;
  updated_at: string;
}

// ============================================
// INSERT TYPES (for creating new records)
// ============================================

export type UserInsert = Omit<User, 'id' | 'created_at' | 'updated_at' | 'first_seen_at' | 'last_seen_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  first_seen_at?: string;
  last_seen_at?: string;
};

export type ConversationInsert = Omit<Conversation, 'id' | 'created_at' | 'updated_at' | 'last_activity_at' | 'message_count'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  last_activity_at?: string;
  message_count?: number;
};

export type UserQueryInsert = Omit<UserQuery, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type BotResponseInsert = Omit<BotResponse, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type MessageReactionInsert = Omit<MessageReaction, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type PlatformConfigInsert = Omit<PlatformConfig, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

// ============================================
// UPDATE TYPES (for updating existing records)
// ============================================

export type UserUpdate = Partial<Omit<User, 'id' | 'created_at' | 'platform' | 'platform_user_id'>>;
export type ConversationUpdate = Partial<Omit<Conversation, 'id' | 'created_at' | 'platform' | 'user_id'>>;
export type UserQueryUpdate = Partial<Omit<UserQuery, 'id' | 'created_at' | 'conversation_id' | 'user_id'>>;
export type BotResponseUpdate = Partial<Omit<BotResponse, 'id' | 'created_at' | 'query_id' | 'conversation_id'>>;
export type MessageReactionUpdate = Partial<Omit<MessageReaction, 'id' | 'created_at' | 'response_id' | 'user_id'>>;
export type PlatformConfigUpdate = Partial<Omit<PlatformConfig, 'id' | 'created_at' | 'platform'>>;

// ============================================
// JOIN TYPES (for queries with relationships)
// ============================================

export interface ConversationWithUser extends Conversation {
  user: User;
}

export interface UserQueryWithUser extends UserQuery {
  user: User;
}

export interface BotResponseWithQuery extends BotResponse {
  user_query: UserQuery;
}

export interface BotResponseWithReactions extends BotResponse {
  message_reactions: MessageReaction[];
}

export interface MessageReactionWithUser extends MessageReaction {
  user: User;
}

export interface FullConversationHistory {
  conversation: ConversationWithUser;
  messages: Array<{
    type: 'query' | 'response';
    data: UserQueryWithUser | BotResponseWithReactions;
    created_at: string;
  }>;
}

// ============================================
// HELPER TYPES
// ============================================

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  metadata?: {
    platform_message_id?: string;
    tokens_used?: number;
    model_used?: string;
    processing_time_ms?: number;
    reactions?: MessageReaction[];
    error_message?: string;
  };
}

export interface UserStats {
  total_queries: number;
  total_responses: number;
  total_tokens_used: number;
  avg_processing_time_ms: number;
  favorite_reactions: string[];
  conversation_count: number;
  first_interaction: string;
  last_interaction: string;
}

export interface PlatformStats {
  platform: PlatformType;
  active_users: number;
  total_conversations: number;
  total_messages: number;
  total_tokens_used: number;
  avg_response_time_ms: number;
  popular_reactions: Array<{
    reaction_name: string;
    count: number;
  }>;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// ============================================
// DATABASE SCHEMA TYPE (for Supabase)
// ============================================

export interface CentralizedDatabase {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: UserInsert;
        Update: UserUpdate;
      };
      conversations: {
        Row: Conversation;
        Insert: ConversationInsert;
        Update: ConversationUpdate;
      };
      user_queries: {
        Row: UserQuery;
        Insert: UserQueryInsert;
        Update: UserQueryUpdate;
      };
      bot_responses: {
        Row: BotResponse;
        Insert: BotResponseInsert;
        Update: BotResponseUpdate;
      };
      message_reactions: {
        Row: MessageReaction;
        Insert: MessageReactionInsert;
        Update: MessageReactionUpdate;
      };
      platform_configs: {
        Row: PlatformConfig;
        Insert: PlatformConfigInsert;
        Update: PlatformConfigUpdate;
      };
    };
    Views: {
      // Add views here if you create any
    };
    Functions: {
      // Add custom functions here if you create any
    };
    Enums: {
      platform_type: PlatformType;
      conversation_status: ConversationStatus;
      message_status: MessageStatus;
    };
  };
}

// ============================================
// MIGRATION TYPES (for the migration process)
// ============================================

export interface OldMessage {
  id: string;
  conversation_id: string;
  message_type: 'user_query' | 'bot_response';
  content: string;
  slack_message_ts?: string;
  tokens_used?: number;
  model_used?: string;
  processing_time_ms?: number;
  error_message?: string;
  created_at: string;
}

export interface OldConversation {
  id: string;
  created_at: string;
}

export interface OldMessageReaction {
  id: string;
  message_id: string;
  slack_user_id: string;
  reaction_name: string;
  created_at: string;
}

export interface MigrationStats {
  users_created: number;
  conversations_updated: number;
  queries_migrated: number;
  responses_migrated: number;
  reactions_migrated: number;
  errors: Array<{
    type: string;
    message: string;
    data?: any;
  }>;
}

// ============================================
// EXPORT COLLECTIONS
// ============================================

export type DatabaseTables = {
  users: User;
  conversations: Conversation;
  user_queries: UserQuery;
  bot_responses: BotResponse;
  message_reactions: MessageReaction;
  platform_configs: PlatformConfig;
};

export type InsertTypes = {
  users: UserInsert;
  conversations: ConversationInsert;
  user_queries: UserQueryInsert;
  bot_responses: BotResponseInsert;
  message_reactions: MessageReactionInsert;
  platform_configs: PlatformConfigInsert;
};

export type UpdateTypes = {
  users: UserUpdate;
  conversations: ConversationUpdate;
  user_queries: UserQueryUpdate;
  bot_responses: BotResponseUpdate;
  message_reactions: MessageReactionUpdate;
  platform_configs: PlatformConfigUpdate;
};

// Default export for easy importing
export default CentralizedDatabase;