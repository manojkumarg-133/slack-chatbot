// Database Types - Centralized Multi-Platform Schema
// Compatible with Slack, Discord, WhatsApp, Telegram, Twitch

export type PlatformType = 'slack' | 'discord' | 'whatsapp' | 'telegram' | 'twitch';
export type ConversationStatus = 'active' | 'archived' | 'deleted';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface User {
  id: string;
  platform: PlatformType;
  platform_user_id: string;
  username?: string;
  display_name?: string;
  email?: string;
  phone_number?: string;
  avatar_url?: string;
  language_code: string;
  timezone?: string;
  is_bot: boolean;
  is_active: boolean;
  notifications_enabled: boolean;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  platform_metadata: Record<string, any>;
}

export interface Conversation {
  id: string;
  platform: PlatformType;
  user_id: string;
  channel_id?: string;
  channel_name?: string;
  thread_id?: string;
  is_group_chat: boolean;
  is_dm: boolean;
  status: ConversationStatus;
  title?: string;
  last_activity_at: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  platform_metadata: Record<string, any>;
}

export interface UserQuery {
  id: string;
  conversation_id: string;
  user_id: string;
  content: string;
  platform_message_id?: string;
  has_attachments: boolean;
  attachment_urls?: string[];
  message_type: string;
  status: MessageStatus;
  created_at: string;
  updated_at: string;
  platform_metadata: Record<string, any>;
}

export interface BotResponse {
  id: string;
  query_id: string;
  conversation_id: string;
  content: string;
  platform_message_id?: string;
  model_used: string;
  tokens_used?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  processing_time_ms?: number;
  has_attachments: boolean;
  attachment_urls?: string[];
  response_type: string;
  error_message?: string;
  error_code?: string;
  retry_count: number;
  status: MessageStatus;
  created_at: string;
  updated_at: string;
  platform_metadata: Record<string, any>;
}

export interface MessageReaction {
  id: string;
  response_id: string;
  user_id: string;
  reaction_name: string;
  reaction_unicode?: string;
  platform: PlatformType;
  created_at: string;
  removed_at?: string;
}

// Insert types (for creating new records)
export type UserInsert = Omit<User, 'id' | 'created_at' | 'updated_at' | 'first_seen_at' | 'last_seen_at'> & {
  first_seen_at?: string;
  last_seen_at?: string;
};
export type ConversationInsert = Omit<Conversation, 'id' | 'created_at' | 'updated_at' | 'last_activity_at' | 'message_count'> & {
  last_activity_at?: string;
  message_count?: number;
};
export type UserQueryInsert = Omit<UserQuery, 'id' | 'created_at' | 'updated_at'>;
export type BotResponseInsert = Omit<BotResponse, 'id' | 'created_at' | 'updated_at'>;
export type MessageReactionInsert = Omit<MessageReaction, 'id' | 'created_at'>;

// Database schema interface for Supabase
export interface Database {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: UserInsert;
        Update: Partial<UserInsert>;
      };
      conversations: {
        Row: Conversation;
        Insert: ConversationInsert;
        Update: Partial<ConversationInsert>;
      };
      user_queries: {
        Row: UserQuery;
        Insert: UserQueryInsert;
        Update: Partial<UserQueryInsert>;
      };
      bot_responses: {
        Row: BotResponse;
        Insert: BotResponseInsert;
        Update: Partial<BotResponseInsert>;
      };
      message_reactions: {
        Row: MessageReaction;
        Insert: MessageReactionInsert;
        Update: Partial<MessageReactionInsert>;
      };
    };
  };
}

// Helper types for Slack-specific operations (for backwards compatibility)
export interface SlackUserData {
  slack_user_id: string;
  slack_team_id?: string;
  display_name?: string;
  username?: string;
  email?: string;
  avatar_url?: string;
}

export interface SlackConversationData {
  slack_channel_id: string;
  slack_thread_ts?: string;
  conversation_title?: string;
}

export interface SlackMessageData {
  slack_message_ts: string;
}
