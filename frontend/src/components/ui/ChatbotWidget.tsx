import { useEffect, useRef, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { 
  MessageSquare, Send, X, Trash2, Sparkles, 
  HelpCircle, ChevronRight, CornerDownLeft
} from "lucide-react";
import { useChatStore } from "../../store/chatStore";
import { useAuth } from "../../hooks/useAuth";

interface RouteContext {
  welcome: string;
  prompts: string[];
}

const CONTEXT_MAP: Record<string, RouteContext> = {
  "/": {
    welcome: "Hi! Welcome to AlgoViz Pro. I'm your AI assistant. Let me know if you have questions about our features, pricing, or how to get started!",
    prompts: [
      "What is AlgoViz Pro?",
      "How do I start visualizing?",
      "Compare Pricing plans"
    ]
  },
  "/pricing": {
    welcome: "Hi there! I see you are checking out our Pricing plans. We offer Free ($0), Pro ($12/mo), and Team ($49/mo) tiers. Ask me anything about what's included or which plan is best for you!",
    prompts: [
      "What's in the Pro plan?",
      "Is there a free tier?",
      "How do I upgrade to Pro?"
    ]
  },
  "/features": {
    welcome: "Hello! Welcome to the Features page. We provide live dynamic visualizations, AI complexity checks, bug detection, and shareable snapshots. What would you like to learn more about?",
    prompts: [
      "How does AI Complexity work?",
      "Which languages are supported?",
      "Can I share my workspace?"
    ]
  },
  "/app": {
    welcome: "Welcome to the Visualizer Workspace! You can paste any C++, Python, Java, or JavaScript algorithm here and hit 'Analyze'. Ask me if you need help writing, debugging, or optimizing your algorithm!",
    prompts: [
      "Show me a Bubble Sort example",
      "Explain Binary Search logic",
      "How does the visualizer trace pointers?"
    ]
  },
  "/docs": {
    welcome: "Hello! Welcome to the documentation. If you can't find what you're looking for, feel free to ask me, and I'll point you to the right guide.",
    prompts: [
      "How do I get an API key?",
      "Where is the syntax guide?",
      "Can I integrate custom libraries?"
    ]
  },
  "/dashboard": {
    welcome: "Welcome back to your Dashboard! How can I assist you with your algorithms history, usage statistics, or API management today?",
    prompts: [
      "Where is my analysis history?",
      "How do I generate an API key?",
      "Tell me about analytics stats"
    ]
  }
};

const DEFAULT_CONTEXT: RouteContext = {
  welcome: "Hello! I am your AlgoViz Pro assistant. How can I help you learn algorithms or navigate our platform today?",
  prompts: [
    "What features are available?",
    "Go to Visualizer App",
    "Explain Bubble Sort complexity"
  ]
};

export function ChatbotWidget() {
  const location = useLocation();
  const { user } = useAuth();
  
  const { 
    isOpen, 
    messages, 
    loading, 
    error, 
    setOpen, 
    toggleOpen, 
    clearHistory, 
    addMessage, 
    sendMessage 
  } = useChatStore();

  const [input, setInput] = useState("");
  const [unread, setUnread] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Get route-based context
  const activePath = location.pathname;
  const pageContext = CONTEXT_MAP[activePath] || DEFAULT_CONTEXT;

  // Sync initial welcome message or update it on navigation if no interaction yet
  useEffect(() => {
    // If messages list is empty, initialize with welcome message
    if (messages.length === 0) {
      const personalizedWelcome = user 
        ? `Hi ${user.name}! ${pageContext.welcome}`
        : pageContext.welcome;
      addMessage("assistant", personalizedWelcome);
      
      if (!isOpen && hasOpened) {
        setUnread(true);
      }
    } else if (messages.length === 1 && messages[0]?.role === "assistant") {
      // If there is ONLY the welcome message, and the path changed, we update the welcome message to be relevant to the new page.
      clearHistory();
      const personalizedWelcome = user 
        ? `Hi ${user.name}! ${pageContext.welcome}`
        : pageContext.welcome;
      addMessage("assistant", personalizedWelcome);
    }
  }, [activePath, user, messages.length, addMessage, clearHistory, pageContext.welcome, isOpen, hasOpened]);

  // Set hasOpened to true when chat is first opened
  useEffect(() => {
    if (isOpen) {
      setUnread(false);
      setHasOpened(true);
    }
  }, [isOpen]);

  // Auto scroll to bottom when messages or loading state changes
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || loading) return;

    const userQuery = input;
    setInput("");
    await sendMessage(userQuery, activePath);
  };

  const handlePromptClick = async (prompt: string) => {
    if (loading) return;
    await sendMessage(prompt, activePath);
  };

  // Helper to parse relative and external links from markdown in chat replies
  const parseMessageContent = (content: string) => {
    // Regex for [link text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    const elements: React.ReactNode[] = [];
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      const text = match[1] || "";
      const url = match[2] || "";
      const textBefore = content.substring(lastIndex, match.index);
      if (textBefore) {
        elements.push(<span key={lastIndex}>{textBefore}</span>);
      }

      const isRelative = url.startsWith('/') && !url.startsWith('//');
      if (isRelative) {
        elements.push(
          <Link 
            key={match.index} 
            to={url} 
            onClick={() => setOpen(false)}
            className="text-indigo-600 dark:text-indigo-400 font-semibold underline hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
          >
            {text}
          </Link>
        );
      } else {
        elements.push(
          <a 
            key={match.index} 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-indigo-600 dark:text-indigo-400 font-semibold underline hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
          >
            {text}
          </a>
        );
      }
      lastIndex = linkRegex.lastIndex;
    }

    const textAfter = content.substring(lastIndex);
    if (textAfter) {
      elements.push(<span key={lastIndex}>{textAfter}</span>);
    }

    return elements.length > 0 ? elements : <span>{content}</span>;
  };

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[9999] font-sans flex flex-col items-end">
      
      {/* ── 1. CHAT WINDOW ────────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className="w-[calc(100vw-32px)] sm:w-[380px] h-[520px] max-h-[80vh] rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden mb-4 Spotlight-card"
          >
            
            {/* ── Header ────────────────────────────────────────────── */}
            <div className="bg-gradient-to-r from-brand-600 via-indigo-600 to-accent-600 px-4 py-3.5 flex items-center justify-between text-white select-none">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center relative">
                  <Sparkles className="w-4 h-4 text-brand-100 animate-pulse" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-indigo-600 absolute -top-0.5 -right-0.5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm tracking-wide">AlgoViz Assistant</h3>
                  <span className="text-[10px] text-brand-100 font-medium flex items-center gap-1 opacity-90">
                    AI Agent • Online
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-1">
                <button
                  onClick={clearHistory}
                  title="Clear Chat History"
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/80 hover:text-white"
                  type="button"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button
                  onClick={toggleOpen}
                  title="Minimize Assistant"
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/80 hover:text-white"
                  type="button"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Messages List ──────────────────────────────────────── */}
            <div 
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
            >
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div
                    key={msg.id}
                    className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser && (
                      <div className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center flex-shrink-0 border border-indigo-100 dark:border-indigo-900 select-none">
                        <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
                      </div>
                    )}
                    
                    <div className="flex flex-col gap-1 max-w-[80%]">
                      <div
                        className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                          isUser
                            ? "bg-indigo-600 text-white rounded-br-none"
                            : "bg-zinc-100 dark:bg-zinc-900 text-zinc-850 dark:text-zinc-200 border border-zinc-200/50 dark:border-zinc-800/40 rounded-bl-none"
                        }`}
                      >
                        {parseMessageContent(msg.content)}
                      </div>
                      <span className={`text-[9px] text-zinc-400 select-none ${isUser ? "text-right mr-1" : "text-left ml-1"}`}>
                        {msg.timestamp}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Bouncing Loader Dots */}
              {loading && (
                <div className="flex items-end gap-2 justify-start">
                  <div className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center flex-shrink-0 border border-indigo-100 dark:border-indigo-900 select-none">
                    <HelpCircle className="w-3.5 h-3.5 text-indigo-500 animate-bounce" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 rounded-bl-none border border-zinc-200/50 dark:border-zinc-800/40 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-[bounce_1.4s_infinite_0s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-[bounce_1.4s_infinite_0.2s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500 animate-[bounce_1.4s_infinite_0.4s]" />
                  </div>
                </div>
              )}

              {/* Error State */}
              {error && (
                <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 p-3 rounded-xl text-xs text-rose-700 dark:text-rose-300 leading-normal flex flex-col gap-2">
                  <p>{error}</p>
                  <button
                    onClick={() => {
                      const lastMsg = messages[messages.length - 1];
                      if (lastMsg && lastMsg.role === "user") {
                        sendMessage(lastMsg.content, activePath);
                      }
                    }}
                    className="self-start text-[10px] font-bold px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded transition-colors"
                  >
                    Retry Query
                  </button>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* ── Contextual Suggestion Prompts ─────────────────────────── */}
            {pageContext.prompts.length > 0 && !loading && (
              <div className="px-4 py-2 bg-zinc-50/50 dark:bg-zinc-950/50 border-t border-zinc-100 dark:border-zinc-900 flex gap-2 overflow-x-auto scrollbar-none whitespace-nowrap select-none">
                {pageContext.prompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => handlePromptClick(prompt)}
                    className="px-3 py-1.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-250/60 dark:border-zinc-800 text-xs font-semibold text-zinc-650 dark:text-zinc-300 hover:border-indigo-550 hover:bg-indigo-50/20 dark:hover:border-indigo-500/30 transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
                  >
                    {prompt} <ChevronRight className="w-3 h-3 text-zinc-405" />
                  </button>
                ))}
              </div>
            )}

            {/* ── Footer Form ───────────────────────────────────────── */}
            <form
              onSubmit={handleSubmit}
              className="p-3 border-t border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 flex items-center gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask assistant, e.g. how does quicksort work?"
                disabled={loading}
                className="flex-1 bg-zinc-50 dark:bg-zinc-900 text-zinc-850 dark:text-zinc-100 rounded-xl px-3.5 py-2 text-sm border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                title="Send Message"
                className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center flex-shrink-0 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 2. LAUNCHER BUTTON ───────────────────────────────────────── */}
      <motion.button
        onClick={toggleOpen}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="w-14 h-14 rounded-full bg-gradient-to-tr from-brand-650 to-indigo-650 dark:from-brand-600 dark:to-indigo-600 hover:from-brand-700 hover:to-indigo-700 text-white flex items-center justify-center shadow-lg hover:shadow-xl relative cursor-pointer outline-none select-none border border-indigo-400/20"
        type="button"
        aria-label="Toggle AI Assistant"
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <X className="w-6 h-6" />
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative"
            >
              <MessageSquare className="w-6 h-6" />
              {unread && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 border-2 border-white dark:border-zinc-950 rounded-full animate-pulse" />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

    </div>
  );
}

export default ChatbotWidget;
