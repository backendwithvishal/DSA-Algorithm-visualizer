import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app.js';
import config from '../config/index.js';

const testMongoUri = 'mongodb://127.0.0.1:27017/dsa_visualizer_test_chat';

beforeAll(async () => {
  config.mongoUri = testMongoUri;
  config.configName = 'test';
  
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(testMongoUri);
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.db.dropDatabase();
    await mongoose.connection.close();
  }
});

describe('AI Chatbot API', () => {
  describe('POST /api/v1/chat', () => {
    it('should process user message successfully (using offline fallback since key is empty in test)', async () => {
      const res = await request(app)
        .post('/api/v1/chat')
        .send({
          messages: [
            { role: 'user', content: 'What is AlgoViz Pro pricing?' }
          ],
          currentPath: '/pricing'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('role');
      expect(res.body.data.role).toBe('assistant');
      expect(res.body.data).toHaveProperty('content');
      expect(res.body.data.content).toContain('pricing'); // Falls back to local pricing response
    });

    it('should reject invalid role in messages list', async () => {
      const res = await request(app)
        .post('/api/v1/chat')
        .send({
          messages: [
            { role: 'invalid-role', content: 'hello' }
          ]
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject empty message content', async () => {
      const res = await request(app)
        .post('/api/v1/chat')
        .send({
          messages: [
            { role: 'user', content: '' }
          ]
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
