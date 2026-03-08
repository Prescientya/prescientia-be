const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth.middleware');
const { getEvents, getEventDetail } = require('../controllers/eventController');

// GET /api/events - list events for the authenticated user
router.get('/', requireAuth, getEvents);

// GET /api/events/:id - single event detail
router.get('/:id', requireAuth, getEventDetail);

module.exports = router;
