const express = require('express');
const router = express.Router();
const arController = require('../controllers/arController');

// Define the route for AR product
router.post('/ar-product', arController.handleARProduct);

module.exports = router;
