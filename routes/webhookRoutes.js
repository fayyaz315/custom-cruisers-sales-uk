const express = require('express');
const { handleVisitStatus } = require('../controllers/webhookController');

const router = express.Router();

// Webhook route for visit status updates
router.post('/webhook/visit-status', handleVisitStatus);

module.exports = router;
