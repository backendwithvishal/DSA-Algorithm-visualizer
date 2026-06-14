import ChatService from '../services/chat.service.js';
import ActivityLog from '../models/ActivityLog.js';
import { ApiResponse } from '../utils/apiResponse.js';

export class ChatController {
  /**
   * Process a chat message request.
   */
  static async sendMessage(req, res, next) {
    try {
      const { messages, currentPath } = req.body;
      const user = req.user || null;
      const userId = user ? user._id : null;

      const result = await ChatService.sendMessage(messages, currentPath, user);

      // Log user activity if they are logged in
      if (userId) {
        try {
          const log = new ActivityLog({
            userId,
            action: 'chat_query',
            description: `Sent a chat query from path: ${currentPath || '/'}`,
            ipAddress: req.ip || 'Unknown',
            userAgent: req.headers['user-agent'] || 'Unknown',
            metadata: {
              currentPath,
              messageCount: messages.length
            }
          });
          await log.save();
        } catch (logErr) {
          // Non-fatal, do not fail request if logging fails
        }
      }

      return ApiResponse.success(res, result, 'Message processed successfully');
    } catch (err) {
      next(err);
    }
  }
}

export default ChatController;
