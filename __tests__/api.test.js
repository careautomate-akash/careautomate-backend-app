import request from 'supertest';
import express from 'express';

// Create a simple mock app for testing
const app = express();
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

describe('API Tests', () => {
    it('should reeturn 200 for health check endpoint', async () => {
        const response = await request(app).get('/api/health');
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('ok');
    });
}); 