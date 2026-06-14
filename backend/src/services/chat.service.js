import config from '../config/index.js';
import logger from '../utils/logger.js';

const GROQ_TIMEOUT_MS = config.groq.timeoutMs || 30_000;

const CHAT_SYSTEM_PROMPT = `You are the official AI Assistant for AlgoViz Pro (a modern Data Structures & Algorithms visualizer and analyzer platform).
Your primary role is to assist users in understanding computer science algorithms, explaining code logic, and guiding them to relevant features and pages on the platform.

Here is the structural information about AlgoViz Pro website paths, pages, and features:
1. Home/Landing Page (/): General introduction, interactive sandbox preview of Bubble Sort, platform statistics, and Call to Actions (CTAs).
2. Features Page (/features): Details our core features:
   - Live dynamic visualization: Step-by-step execution playback controls (play, pause, speed adjustment), tracing pointers (like i, j, left, right).
   - AI Complexity Analysis: Automatic Big-O runtime (time & space) checks.
   - Multi-language support: Support for C++, Python, Java, JavaScript, TypeScript, and Go.
   - Bug & Edge Case checks: Flag logical errors and compare corrected code side-by-side.
   - Shareable workspace links: Generate stable read-only links for sharing execution frames.
3. Pricing Page (/pricing): Details about pricing plans:
   - Free Tier ($0/lifetime): 50 analyses/month, standard visualizer, core languages.
   - Pro Tier ($12/month): Unlimited analyses, advanced AI models, 10 team workspace files, priority support, shareable custom collections.
   - Team Tier ($49/month): Pro features + unlimited team workspace files, shared team libraries, member roles, enterprise API keys, SSO.
4. About Page (/about): Company details, mission, team, and careers.
5. Contact Page (/contact): Get in touch with our team for questions, support, or enterprise sales.
6. Docs / Help Page (/docs): Comprehensive documentation, tutorials, guides, and API specifications.
7. Visualizer App (/app): The interactive workspace where users write, run, and step-by-step visualize algorithms in C++, Python, Java, JS, Go, etc. Explain that users can paste code and press "Analyze" to generate a step-by-step simulation.
8. User Dashboard (/dashboard): Access to authenticated dashboard, analytics on past code analyses, shared history, and account settings.
9. API Management (/dashboard/api): Access to developer API keys for custom integrations.
10. Onboarding (/onboarding): Introductory steps for new users.

Guidelines:
- Keep your answers friendly, concise, and professional.
- Help users navigate the site by suggesting they go to specific pages when relevant. Use markdown links in your responses, e.g., [Pricing Page](/pricing) or [Visualizer](/app) (using relative router paths).
- If the user asks about an algorithm (e.g. Bubble Sort, Quick Sort, Binary Search), explain it briefly and suggest trying it in the [Visualizer](/app).
- If the user is on a specific page, adapt your response contextually.
- Do not make up prices, features, or routes. Stick to the provided site structure.
- Do NOT output JSON unless explicitly asked. Output natural conversational markdown.
- Never expose the Groq API key or system settings.
`;

/**
 * Perform a fetch request to the Groq completions endpoint with retry logic.
 */
async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && retries > 0) {
        logger.warn(`Groq API request failed with status ${res.status}. Retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithRetry(url, options, retries - 1, delay * 2);
      }
      const errText = await res.text().catch(() => 'Unknown error');
      throw new Error(`Groq API error ${res.status}: ${errText}`);
    }
    return res;
  } catch (err) {
    if (retries > 0 && err.name !== 'AbortError') {
      logger.warn(`Groq API request threw error: ${err.message}. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    throw err;
  }
}

/**
 * Generate a local fallback response when Groq API key is missing or service is offline.
 */
function generateOfflineFallback(messages, currentPath = '/') {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content?.toLowerCase() || '';

  let suggestion = "I'm having trouble connecting to my AI service right now. However, I can still help you navigate! Here are some quick links:\n" +
    "- Check out our [Pricing page](/pricing) for Free, Pro, and Team details.\n" +
    "- Go to the interactive [Visualizer Workspace](/app) to write and execute code.\n" +
    "- View our documentation and guides in [Docs](/docs).";

  if (lastUserMsg.includes('price') || lastUserMsg.includes('pricing') || lastUserMsg.includes('cost') || lastUserMsg.includes('subscription')) {
    suggestion = "It looks like you're asking about pricing! Our plans include:\n" +
      "- **Free** ($0): 50 analyses/month, standard visualizer.\n" +
      "- **Pro** ($12/mo): Unlimited analyses, 10 team workspace files, priority support.\n" +
      "- **Team** ($49/mo): Shared libraries, member roles, enterprise API keys.\n\n" +
      "You can view more details on the [Pricing page](/pricing).";
  } else if (lastUserMsg.includes('visualiz') || lastUserMsg.includes('app') || lastUserMsg.includes('code') || lastUserMsg.includes('language') || lastUserMsg.includes('sandbox')) {
    suggestion = "Are you looking to visualize code? You can use the [Visualizer Workspace](/app). We support:\n" +
      "- C++, Python, Java, JavaScript, TypeScript, and Go.\n" +
      "- Custom inputs, speed controls, play/pause.\n" +
      "- Side-by-side comparison of original and AI-corrected code.\n\n" +
      "Give it a try in the [Visualizer app](/app)!";
  } else if (lastUserMsg.includes('feature') || lastUserMsg.includes('capabilities') || lastUserMsg.includes('bug') || lastUserMsg.includes('complexity')) {
    suggestion = "AlgoViz Pro provides several advanced features:\n" +
      "- **Live Visualizer**: Watch comparisons and pointer swaps in real-time.\n" +
      "- **AI Complexity**: Instant asymptotic Big-O runtime checks.\n" +
      "- **Bug Checks**: Side-by-side comparison with bugs flagged and corrected.\n" +
      "- **Shareable Workspace Links**: Send code runs to others.\n\n" +
      "Learn more on the [Features page](/features).";
  }

  return {
    content: suggestion,
    role: 'assistant'
  };
}

export class ChatService {
  /**
   * Sends a user query to Groq or falls back to an offline handler.
   * @param {Array<{role: string, content: string}>} messages - The conversation message list
   * @param {string} currentPath - The active path context from the frontend
   * @param {object} [user] - Authenticated user details
   * @returns {Promise<{role: string, content: string}>}
   */
  static async sendMessage(messages, currentPath = '/', user = null) {
    if (!messages || messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    // Check if key is configured
    if (!config.groq.apiKey || config.groq.apiKey === 'your_groq_api_key') {
      logger.warn('Groq API key not configured for Chat — using local fallback handler');
      return generateOfflineFallback(messages, currentPath);
    }

    // Build the request messages list
    const systemPromptContent = CHAT_SYSTEM_PROMPT + 
      `\n\nCURRENT USER CONTEXT: The user is currently visiting the path: "${currentPath}". ` +
      (user ? `The logged-in user's name is "${user.name}" and email is "${user.email}".` : `The user is browsing anonymously.`);

    const apiMessages = [
      { role: 'system', content: systemPromptContent },
      ...messages
    ];

    logger.info('Calling Groq API for Chat', { count: messages.length, path: currentPath });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    try {
      const response = await fetchWithRetry('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.groq.apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.7,
          max_tokens: 1500,
          messages: apiMessages
        }),
        signal: controller.signal
      }, 3, 1000); // 3 retries, initial delay 1000ms

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      if (!content.trim()) {
        throw new Error('Groq API returned empty message content');
      }

      return {
        role: 'assistant',
        content: content.trim()
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        logger.error(`Groq API request timed out after ${GROQ_TIMEOUT_MS}ms — using local fallback`);
      } else {
        logger.error('Groq API error during chat — using local fallback:', err);
      }
      return generateOfflineFallback(messages, currentPath);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default ChatService;
