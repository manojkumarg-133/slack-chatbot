// Gemini AI helper functions for Supabase Edge Functions
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CentralizedDB } from './centralized-database.ts';

let genAI: GoogleGenerativeAI | null = null;


export function initializeGemini() {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (apiKey) {
    try {
      genAI = new GoogleGenerativeAI(apiKey);
      console.log('✅ Gemini AI initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Gemini AI:', error);
      return false;
    }
  } else {
    console.warn('⚠️ GEMINI_API_KEY is not set. Gemini features will be disabled.');
    return false;
  }
}

/**
 * Analyze emoji reactions to determine sentiment
 */
function analyzeReactionSentiment(reactions: string[]): string {
  if (reactions.length === 0) return '';

  const positive = ['+1', 'thumbsup', 'heart', 'heart_eyes', 'fire', 'star', 'clap', 'raised_hands', '100', 'white_check_mark', 'ok_hand', 'muscle', 'sparkles', 'tada'];
  const negative = ['-1', 'thumbsdown', 'x', 'angry', 'rage', 'disappointed', 'confused', 'thinking_face', 'face_with_raised_eyebrow'];
  const neutral = ['eyes', 'thinking', 'shrug'];

  const positiveCount = reactions.filter(r => positive.includes(r)).length;
  const negativeCount = reactions.filter(r => negative.includes(r)).length;
  const neutralCount = reactions.filter(r => neutral.includes(r)).length;

  if (positiveCount > negativeCount) {
    return 'positive (user appreciated the response)';
  } else if (negativeCount > positiveCount) {
    return 'negative (user was dissatisfied or found the response unhelpful)';
  } else if (neutralCount > 0) {
    return 'neutral (user was uncertain or needed clarification)';
  }
  return 'mixed';
}

/**
 * Build conversation context with intelligent selection
 */
function buildConversationContext(
  conversationHistory: Array<{ role: string; content: string; reactions?: any[]; reactionContext?: string }>,
  currentPrompt: string
): string {
  // Ensure conversationHistory is an array
  if (!conversationHistory || !Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    console.log('🔍 No valid conversation history found or not an array:', typeof conversationHistory, conversationHistory);
    return '';
  }

  // Always include recent context (last 8 messages)
  const recentMessages = conversationHistory.slice(-8);
  
  // If we have more history, look for relevant messages based on keywords
  let relevantMessages: typeof conversationHistory = [];
  if (conversationHistory.length > 8) {
    const keywords = currentPrompt.toLowerCase().split(' ').filter(word => word.length > 3);
    
    relevantMessages = conversationHistory.slice(0, -8).filter(msg => {
      const content = msg.content.toLowerCase();
      return keywords.some(keyword => content.includes(keyword));
    }).slice(-4); // Limit to 4 most relevant older messages
  }
  
  // Combine relevant older messages with recent messages
  const contextMessages = [...relevantMessages, ...recentMessages];
  const contextParts: string[] = [];
  
  // Add header if we have relevant older context
  if (relevantMessages.length > 0) {
    contextParts.push('=== ONGOING CONVERSATION ===\n\n(This is a continuing conversation. Previous context is available.)\n');
  }
  
  for (const msg of contextMessages) {
    if (msg.role === 'user') {
      contextParts.push(`User: ${msg.content}`);
    } else {
      let assistantPart = `Assistant: ${msg.content}`;
      
      // Add reaction analysis if available
      if (msg.reactions && msg.reactions.length > 0) {
        const reactionNames = msg.reactions.map((r: any) => r.reaction_name);
        const sentiment = analyzeReactionSentiment(reactionNames);
        assistantPart += `\n[User's reaction: ${reactionNames.join(', ')} - Sentiment: ${sentiment}]`;
      }
      
      contextParts.push(assistantPart);
    }
  }
  
  return contextParts.join('\n\n');
}

/**
 * Simple language detection
 */
function detectLanguage(text: string): { language: string; confidence: number } {
  const languagePatterns = {
    english: /\b(hello|hi|hey|thank you|thanks|please|yes|no|how|what|where|when|the|and|for|you|are|bot)\b/i,
    spanish: /\b(hola|gracias|por favor|sí|no|cómo|qué|dónde|cuándo)\b/i,
    french: /\b(bonjour|merci|s'il vous plaît|oui|non|comment|quoi|où|quand)\b/i,
    german: /\b(hallo|danke|bitte|ja|nein|wie|was|wo|wann|ich|du|der|die|das)\b/i,
    italian: /\b(ciao|grazie|per favore|sì|no|come|cosa|dove|quando)\b/i,
    portuguese: /\b(olá|obrigado|por favor|sim|não|como|o que|onde|quando)\b/i,
    russian: /\b(привет|спасибо|пожалуйста|да|нет|как|что|где|когда)\b/i,
    japanese: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/,
    chinese: /[\u4E00-\u9FFF]/,
    korean: /[\uAC00-\uD7AF]/,
    arabic: /[\u0600-\u06FF]/,
    hindi: /[\u0900-\u097F]/,
    telugu: /[\u0C00-\u0C7F]|నేను|మీరు|ఎలా|ఏమి|ఎక్కడ|ఎప్పుడు/i,
  };

  for (const [lang, pattern] of Object.entries(languagePatterns)) {
    if (pattern.test(text)) {
      return { language: lang, confidence: 0.8 };
    }
  }

  // Default to English with high confidence for short messages or common English words
  return { language: 'english', confidence: 0.9 };
}

/**
 * Generate a response from Gemini with multilingual support
 */
export async function generateGeminiResponse(
  prompt: string,
  conversationId: string,
  slackUserId: string,
  modelName: string = 'gemini-2.5-flash',
  userMessageForLanguageDetection?: string
): Promise<{
  success: boolean;
  response: string;
  tokensUsed?: number;
  processingTime: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    if (!genAI) {
      initializeGemini();
      if (!genAI) {
        throw new Error('Gemini AI is not initialized');
      }
    }

    // Detect user's language from the current message, not the full prompt with history
    const textForLanguageDetection = userMessageForLanguageDetection || prompt;
    const detection = detectLanguage(textForLanguageDetection);
    console.log(`🌐 Detected language: ${detection.language} (confidence: ${detection.confidence}) from: "${textForLanguageDetection.substring(0, 50)}..."`);

    // Create model without systemInstruction (Gemini 2.0 Flash compatibility)
    const model = genAI.getGenerativeModel({ 
      model: modelName
    });

    // Get conversation history from database
    const historyResult = await CentralizedDB.getConversationHistory(conversationId);
    const conversationHistory = historyResult.success ? historyResult.messages : [];
    console.log(`📚 Retrieved ${conversationHistory?.length || 0} messages from conversation history for conversation ${conversationId}`);

    // Build full prompt with conversation context including reactions
    let fullPrompt = prompt;
    
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      const historyContext = buildConversationContext(conversationHistory, prompt);
      console.log(`🧠 Gemini Context - History length: ${conversationHistory.length}`);
      console.log(`📝 Built context preview (first 200 chars): ${historyContext.substring(0, 200)}...`);
      fullPrompt = `${historyContext}\n\nUser: ${prompt}`;
    } else {
      console.log(`🔄 Gemini - No conversation history provided, treating as new conversation`);
    }

    // Add system instructions and language context to the prompt
    let systemPrompt;
    if (detection.language === 'english') {
      systemPrompt = `You are a helpful AI assistant in a Slack workspace. 

CRITICAL: You MUST respond in ENGLISH ONLY. The user wrote their message in English, so you must reply in English.

Keep responses concise, helpful, and professional. Always use English language for your response.\n\n`;
    } else {
      systemPrompt = `You are a helpful AI assistant in a Slack workspace. 

IMPORTANT: The user's current message is in ${detection.language}. You MUST respond in the same language as the user's CURRENT message, which is ${detection.language}. 

Keep responses concise, helpful, and professional.\n\n`;
    }
    const languageContextPrompt = systemPrompt + fullPrompt;

    const result = await model.generateContent(languageContextPrompt);
    const response = await result.response;
    const text = response.text();

    const processingTime = Date.now() - startTime;

    // Try to get token count if available
    let tokensUsed;
    try {
      tokensUsed = response.usageMetadata?.totalTokenCount;
    } catch (e) {
      // Token count not available
    }

    // Note: Database saves are handled by the main event handler
    let queryId = 'handled-by-main-handler';
    console.log('💾 Database saves handled by main event handler');

    return {
      success: true,
      response: text,
      tokensUsed,
      processingTime
    };
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error('Error generating Gemini response:', error);
    
    return {
      success: false,
      response: '',
      processingTime,
      error: error.message || 'Unknown error occurred'
    };
  }
}

/**
 * Generate a conversation title from the first message
 */
export async function generateConversationTitle(firstMessage: string): Promise<string> {
  try {
    if (!genAI) {
      initializeGemini();
      if (!genAI) {
        return firstMessage.substring(0, 50);
      }
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `Generate a short, descriptive title (max 8 words) for a conversation that starts with this message: "${firstMessage}". Only respond with the title, nothing else.`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const title = response.text().trim();
    
    return title.substring(0, 100); // Limit to 100 chars
  } catch (error) {
    console.error('Error generating conversation title:', error);
    return firstMessage.substring(0, 50);
  }
}

/**
 * Generate a response based on emoji reaction sentiment
 */
export async function generateReactionResponse(
  reactionName: string,
  originalMessage?: string
): Promise<{ success: boolean; response: string; error?: string }> {
  try {
    const positive = ['+1', 'thumbsup', 'heart', 'heart_eyes', 'fire', 'star', 'clap', 'raised_hands', '100', 'white_check_mark', 'ok_hand', 'muscle', 'sparkles', 'tada'];
    const negative = ['-1', 'thumbsdown', 'x', 'angry', 'rage', 'disappointed', 'confused', 'thinking_face', 'face_with_raised_eyebrow'];
    const neutral = ['eyes', 'thinking', 'shrug'];

    let sentiment = 'neutral';
    if (positive.includes(reactionName)) {
      sentiment = 'positive';
    } else if (negative.includes(reactionName)) {
      sentiment = 'negative';
    }

    let responseText = '';
    
    if (sentiment === 'positive') {
      const positiveResponses = [
        "Glad you found that helpful! 😊",
        "Thanks for the positive feedback! 👍",
        "Happy to help! Let me know if you need anything else.",
        "Great to hear that worked for you! 🎉",
        "Awesome! I'm here if you have more questions.",
        "Perfect! I'm glad I could assist you.",
        "Wonderful! Thanks for letting me know it was useful."
      ];
      responseText = positiveResponses[Math.floor(Math.random() * positiveResponses.length)];
    } else if (sentiment === 'negative') {
      const negativeResponses = [
        "Sorry that didn't match your expectations. Let me try to help you differently.",
        "I apologize if my response wasn't helpful. Could you clarify what you're looking for?",
        "Sorry about that! Can you tell me more about what you need?",
        "I understand that wasn't quite right. How can I better assist you?",
        "Sorry for the confusion. Let me know how I can improve my response.",
        "I apologize if that wasn't what you were looking for. What would be more helpful?",
        "Sorry that didn't work out. Please let me know what you'd prefer instead."
      ];
      responseText = negativeResponses[Math.floor(Math.random() * negativeResponses.length)];
    } else {
      const neutralResponses = [
        "I see you're thinking about this. Let me know if you need clarification!",
        "Looks like you might have questions. Feel free to ask!",
        "I notice you reacted - is there something specific you'd like to know?",
        "Thanks for the reaction! Let me know if you need any adjustments.",
        "I see your reaction. How can I help you further?",
        "Noted! Is there anything else you'd like me to explain?"
      ];
      responseText = neutralResponses[Math.floor(Math.random() * neutralResponses.length)];
    }

    return {
      success: true,
      response: responseText
    };
  } catch (error: any) {
    console.error('Error generating reaction response:', error);
    return {
      success: false,
      response: "Thanks for the reaction!",
      error: error.message || 'Unknown error occurred'
    };
  }
}

/**
 * Check if Gemini is initialized
 */
export function isGeminiInitialized(): boolean {
  return genAI !== null;
}

// Initialize on import
initializeGemini();