// Gemini API helper functions
import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI: GoogleGenerativeAI | null = null;

/**
 * Initialize Gemini AI
 */
export function initializeGemini() {
  if (process.env.GEMINI_API_KEY) {
    try {
      genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
 * Build conversation context with reaction analysis and smart truncation
 */
function buildConversationContext(conversationHistory: Array<{ role: string; content: string; reactions?: any[]; reactionContext?: string }>, currentPrompt?: string): string {
  if (!conversationHistory || conversationHistory.length === 0) return '';

  const contextParts: string[] = [];
  
  // Add a summary of the conversation if we have many messages
  if (conversationHistory.length > 8) {
    contextParts.push("=== ONGOING CONVERSATION ===");
    contextParts.push("(This is a continuing conversation with full message history available. Reference previous exchanges when relevant.)");
    contextParts.push("");
  }
  
  // Intelligent context selection
  let selectedMessages: Array<{ role: string; content: string; reactions?: any[]; reactionContext?: string }> = [];
  
  if (conversationHistory.length <= 15) {
    // If conversation is short, include everything
    selectedMessages = conversationHistory;
  } else {
    // For longer conversations, include:
    // 1. First few messages for context
    // 2. Recent messages for continuity
    // 3. Any messages that might be related to current prompt
    
    const firstMessages = conversationHistory.slice(0, 3);
    const recentMessages = conversationHistory.slice(-10);
    
    // Find potentially relevant messages based on keywords
    let relevantMessages: Array<{ role: string; content: string; reactions?: any[]; reactionContext?: string }> = [];
    if (currentPrompt) {
      const promptWords = currentPrompt.toLowerCase().split(/\s+/);
      relevantMessages = conversationHistory.filter(msg => {
        const content = msg.content.toLowerCase();
        return promptWords.some(word => 
          word.length > 3 && content.includes(word)
        );
      }).slice(0, 5); // Limit to 5 relevant messages
    }
    
    // Combine and deduplicate
    const allSelected = [...firstMessages, ...relevantMessages, ...recentMessages];
    const seen = new Set<string>();
    selectedMessages = allSelected.filter(msg => {
      const key = `${msg.role}-${msg.content.substring(0, 50)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    // Sort by original order
    selectedMessages.sort((a, b) => {
      const aIndex = conversationHistory.indexOf(a);
      const bIndex = conversationHistory.indexOf(b);
      return aIndex - bIndex;
    });
  }
  
  // Build context from selected messages
  for (const msg of selectedMessages) {
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
 * Simple language detection helper (basic patterns)
 */
function detectLanguageHints(text: string): string {
  const lowerText = text.toLowerCase();
  
  // Simple pattern matching for common phrases
  if (/hola|buenos días|gracias|por favor|cómo|está/i.test(text)) return 'Spanish';
  if (/bonjour|merci|comment|ça va|s'il vous plaît/i.test(text)) return 'French';
  if (/namaste|kaise|hai|dhanyawad|kya|aap/i.test(text)) return 'Hindi';
  if (/ne peru|enti|ela|unnavu|ela unnav|nenu|meeru|mee/i.test(text)) return 'Telugu';
  if (/你好|谢谢|请问|怎么|什么/i.test(text)) return 'Chinese';
  if (/こんにちは|ありがとう|すみません|どう|何/i.test(text)) return 'Japanese';
  if (/hallo|danke|bitte|wie|was/i.test(text)) return 'German';
  if (/مرحبا|شكرا|من فضلك|كيف|ماذا/i.test(text)) return 'Arabic';
  
  return 'English (or other)';
}

/**
 * Generate a response from Gemini
 */
export async function generateGeminiResponse(
  prompt: string,
  conversationHistory?: Array<{ role: string; content: string; reactions?: any[]; reactionContext?: string }>,
  modelName: string = 'gemini-2.5-flash'
): Promise<{
  text: string;
  tokensUsed?: number;
  processingTime: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    if (!genAI) {
      throw new Error('Gemini AI is not initialized');
    }

    // Enhanced system instruction with emotional intelligence, conversation memory, and multilingual support
    const systemInstruction = `You are Zen-AI, a helpful multilingual assistant in a Slack workspace with emotional intelligence, conversation memory, and full multilingual capabilities.

**🌍 MULTILINGUAL SUPPORT - CRITICAL RULE:**
- You are fully capable of understanding and responding in ALL world languages
- ALWAYS respond in the EXACT SAME language as the user's input
- Never claim you cannot speak a language - you can communicate in any language
- If user writes in Spanish → respond fluently in Spanish
- If user writes in French → respond fluently in French  
- If user writes in Hindi → respond fluently in Hindi
- If user writes in Telugu → respond fluently in Telugu
- If user writes in Chinese → respond fluently in Chinese
- If user writes in Japanese → respond fluently in Japanese
- If user writes in Arabic → respond fluently in Arabic
- If user writes in German → respond fluently in German
- If user writes in any other language → respond fluently in that language

**Examples:**
- User: "ne peru enti?" (Telugu) → You respond: "Nenu Zen-AI. Nenu meeku sahayapadataniki ikkada unna..."
- User: "आपका नाम क्या है?" (Hindi) → You respond: "मेरा नाम Zen-AI है। मैं आपकी सहायता के लिए यहाँ हूँ..."
- Support ALL languages naturally and maintain your helpful personality
- When switching languages, acknowledge: "I'll continue in [language]" in that language

**CRITICAL - Conversation Memory:**
- You MUST acknowledge and reference previous messages in this conversation
- When a user asks about something they mentioned before, ALWAYS acknowledge "As we discussed earlier" or "You asked me about this before"
- DO NOT say "I don't have access to previous conversations" - you DO have access via the conversation history provided
- If someone asks if they mentioned something before, check the conversation history and confirm
- Build on previous interactions naturally and reference them explicitly when relevant

**IMPORTANT - Conversation Continuity:**
- You have access to the full conversation history with this user
- ALWAYS reference and build upon previous interactions when relevant  
- Remember what the user has asked before and what you've already explained
- Don't repeat information you've already provided unless asked to clarify
- Acknowledge follow-up questions by referencing the previous context
- If the user asks "what about X?" or "and Y?", connect it to previous discussion

**Conversation Context:**
- You receive feedback through emoji reactions on your previous responses
- Positive reactions (👍, ❤️, 🔥, ⭐) indicate the user found your answer helpful
- Negative reactions (👎, ❌, 😠) mean the user was dissatisfied - adjust your approach
- Neutral reactions (👀, 🤔, 🤷) suggest the user needs more clarity or detail

**How to respond based on reactions:**
- If user reacted positively: Continue with the same style and depth
- If user reacted negatively: Provide more detail, clarify, or try a different approach
- If user reacted with confusion (🤔): Break down your explanation into simpler terms
- If no reactions: Maintain your current approach

**Response Guidelines:**
- ALWAYS acknowledge conversation context when available ("As we discussed earlier...", "Building on our previous conversation...")
- Keep responses clear and concise
- Use bullet points and formatting for complex answers
- Break information into digestible sections
- Prioritize important information first
- If response would exceed 30,000 characters, provide summary and key points
- Adapt your communication style based on user feedback (reactions)

**Language Examples:**
- English: "Hello! How can I help you?"
- Spanish: "¡Hola! ¿Cómo puedo ayudarte?"
- French: "Bonjour ! Comment puis-je vous aider ?"
- Hindi: "नमस्ते! मैं आपकी कैसे सहायता कर सकता हूँ?"
- Telugu: "నమస్కారం! నేను మీకు ఎలా సహాయపడగలను?"
- Chinese: "你好！我怎么能帮助你？"
- German: "Hallo! Wie kann ich Ihnen helfen?"
- Japanese: "こんにちは！どのようにお手伝いできますか？"

Remember: You are maintaining an ongoing conversation in the user's preferred language, not starting fresh each time!`;

    const model = genAI.getGenerativeModel({ 
      model: modelName,
      systemInstruction
    });

    // Detect language for additional context
    const detectedLanguage = detectLanguageHints(prompt);
    console.log(`🌍 Language hint detected: ${detectedLanguage} for prompt: "${prompt.substring(0, 50)}..."`);

    // Build full prompt with conversation context including reactions
    let fullPrompt = prompt;
    if (conversationHistory && conversationHistory.length > 0) {
      const historyContext = buildConversationContext(conversationHistory, prompt);
      console.log(`🧠 Gemini Context - History length: ${conversationHistory.length}`);
      console.log(`📝 Built context preview (first 300 chars): ${historyContext.substring(0, 300)}...`);
      fullPrompt = `${historyContext}\n\nUser: ${prompt}`;
    } else {
      console.log(`🔄 Gemini - No conversation history provided, treating as new conversation`);
      fullPrompt = `User: ${prompt}`;
    }

    // Add explicit language instruction if non-English detected
    if (detectedLanguage !== 'English') {
      fullPrompt = `[CRITICAL INSTRUCTION: The user is writing in ${detectedLanguage}. You MUST respond entirely in ${detectedLanguage}. Do not use English or claim you cannot speak ${detectedLanguage}.]\n\n${fullPrompt}`;
      console.log(`🌍 Added critical ${detectedLanguage} language instruction to prompt`);
    }

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    const processingTime = Date.now() - startTime;

    // Try to get token count if available
    let tokensUsed;
    try {
      // Note: Token counting might not be available in all SDK versions
      tokensUsed = response.usageMetadata?.totalTokenCount;
    } catch (e) {
      // Token count not available
    }

    return {
      text,
      tokensUsed,
      processingTime
    };
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error('Error generating Gemini response:', error);
    
    return {
      text: '',
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
      return firstMessage.substring(0, 50);
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
 * Check if Gemini is initialized
 */
export function isGeminiInitialized(): boolean {
  return genAI !== null;
}

initializeGemini();
