import { Router } from 'express';
import ChatController from '../controllers/chat.controller.js';
import { optionalAuthenticate } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { chatLimiter } from '../middlewares/rateLimiter.js';
import { chatSchema } from '../validators/schemas.js';

const router = Router();

// Handle incoming chatbot queries (supports anonymous and authenticated users)
router.post('/', chatLimiter, optionalAuthenticate, validate(chatSchema), ChatController.sendMessage);

export default router;
