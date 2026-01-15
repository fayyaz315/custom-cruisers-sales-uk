const express = require('express')
const router = express.Router()
const { handleOrderWebhook } = require('../controllers/orders')

router.post('/', handleOrderWebhook)

module.exports = router
