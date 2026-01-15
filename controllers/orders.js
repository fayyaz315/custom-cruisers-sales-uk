const axios = require('axios')
const https = require('https')
const http = require('http')
const crypto = require('crypto')
const { URL } = require('url')
const ProcessedOrder = require('../models/Order')
require('dotenv').config()

const allowedSKUs = ['GLOBAL-MOU-PRISM-6X6', 'GLOBAL-MOU-PRISM-6X8']

function getDirectLink(properties) {
  const match = properties?.find(p =>
    p.name === '_Upload your certificate 1 (Direct Link)'
  )
  return match?.value || ''
}

function fetchImageAndHash(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const client = parsedUrl.protocol === 'https:' ? https : http

    client.get(url, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        const hash = crypto.createHash('md5').update(buffer).digest('hex')
        resolve(hash)
      })
    }).on('error', reject)
  })
}

const handleOrderWebhook = async (req, res) => {
  const order = req.body
  console.log('🔔 New Order Webhook Received:', order.id)

  let record

  try {
    const exists = await ProcessedOrder.findOne({ shopifyOrderId: order.id })
    if (exists) return res.status(200).send('Duplicate webhook ignored')

    record = await ProcessedOrder.create({ shopifyOrderId: order.id })

    const validItem = order.line_items.find(item => allowedSKUs.includes(item.sku))
    if (!validItem) return res.status(200).send('No valid SKU found')

    const imageUrl = getDirectLink(validItem.properties)
    console.log('Image URL:', imageUrl)
    if (!imageUrl) return res.status(200).send('No image found')

    const md5Hash = await fetchImageAndHash(imageUrl)

    const payload = {
      merchantReference: order.id.toString(),
      shippingMethod: 'Standard',
      recipient: {
        name: `${order.billing_address.first_name} ${order.billing_address.last_name}`,
        address: {
          line1: order.billing_address.address1,
          line2: order.billing_address.address2 || order.billing_address.address1 || '',
          postalOrZipCode: order.billing_address.zip,
          countryCode: order.billing_address.country_code,
          townOrCity: order.billing_address.city,
          stateOrCounty: order.billing_address.country || order.billing_address.province || null
        }
      },
      items: [
        {
          merchantReference: validItem.id.toString(),
          sku: validItem.sku,
          copies: validItem.quantity,
          sizing: 'fillPrintArea',
          recipientCost: {
            amount: validItem.price,
            currency: order.currency || 'USD'
          },
          assets: [
            {
              printArea: 'default',
              url: imageUrl,
              md5Hash,
              pageCount: 1
            }
          ]
        }
      ],
      metadata: {
        shopifyOrderId: order.id,
        source: 'webhook'
      }
    }

    console.log('📦 Payload to be sent to Prodigi:')
    console.log(JSON.stringify(payload, null, 2))

    const prodigiRes = await axios.post(process.env.PRODIGI_API_URL, payload, {
      headers: {
        'X-API-Key': process.env.PRODIGI_API_KEY,
        'Content-Type': 'application/json'
      }
    })

    console.log('✅ Prodigi Response:', prodigiRes.data)
    res.status(200).send('✅ Order placed successfully and sent to Prodigi')

  } catch (err) {
    console.error('❌ Webhook Error:', err.response?.data || err.message)

    if (record) {
      try {
        await ProcessedOrder.findByIdAndDelete(record._id)
        console.log('🗑️ Rolled back: Deleted saved record due to error')
      } catch (deleteErr) {
        console.error('⚠️ Failed to delete rollback record:', deleteErr.message)
      }
    }

    res.status(500).send('Webhook processing error')
  }
}

module.exports = { handleOrderWebhook }
