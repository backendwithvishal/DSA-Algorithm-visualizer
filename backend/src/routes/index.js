import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import apiKeyRoutes from './apiKey.routes.js';
import analysisRoutes from './analysis.routes.js';
import notificationRoutes from './notification.routes.js';
import contactRoutes from './contact.routes.js';
import fileRoutes from './file.routes.js';
import auditRoutes from './audit.routes.js';
import chatRoutes from './chat.routes.js';

const router = Router();

// Register sub-routers
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/api-keys', apiKeyRoutes);
router.use('/analyze', analysisRoutes); // Caches and analyzes DSA code
router.use('/notifications', notificationRoutes);
router.use('/contacts', contactRoutes);
router.use('/files', fileRoutes);
router.use('/logs', auditRoutes); // Audit, Activity, Security log management
router.use('/chat', chatRoutes); // Site-wide AI chatbot assistant

export default router;
