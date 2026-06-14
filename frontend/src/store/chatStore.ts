import { create } from 'zustand';
import { apiClient } from '../lib/apiClient';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;

  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  clearHistory: () => void;
  addMessage: (role: 'user' | 'assistant' | 'system', content: string) => void;
  sendMessage: (content: string, currentPath: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  messages: [],
  loading: false,
  error: null,

  toggleOpen: (): void => set((state) => ({ isOpen: !state.isOpen })),
  setOpen: (isOpen: boolean): void => set({ isOpen }),
  clearHistory: (): void => set({ messages: [], error: null }),

  addMessage: (role: 'user' | 'assistant' | 'system', content: string): void => {
    const newMessage: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      role,
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    set((state) => ({
      messages: [...state.messages, newMessage]
    }));
  },

  sendMessage: async (content: string, currentPath: string): Promise<void> => {
    if (!content.trim()) return;

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      role: 'user',
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      loading: true,
      error: null
    }));

    try {
      // Get the existing messages in the store (excluding system, formatted for the API)
      // Limit history to last 15 messages to save token usage and prevent large payloads
      const chatHistory = get().messages
        .slice(-15)
        .map(({ role, content }) => ({ role, content }));

      const data = await apiClient.post<{ role: 'user' | 'assistant' | 'system'; content: string }>('/chat', {
        messages: chatHistory,
        currentPath
      });

      if (data && data.content) {
        const assistantMessage: ChatMessage = {
          id: Math.random().toString(36).substring(2, 9),
          role: 'assistant',
          content: data.content,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        set((state) => ({
          messages: [...state.messages, assistantMessage],
          loading: false
        }));
      } else {
        throw new Error('Invalid response received from assistant');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      set({
        loading: false,
        error: errMsg
      });
    }
  }
}));

export default useChatStore;
