const axios = require('axios')
const fs = require('fs')
const path = require('path')
require('dotenv').config()

const fetchBtsProducts = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getListProducts`

  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${process.env.TOKEN}`
    }
  })

  const products = response.data
  const count = Array.isArray(products) ? products.length : 0

  const dataPath = path.join(__dirname, '..', 'data', 'products.json')
  fs.writeFileSync(dataPath, JSON.stringify(products))

  console.log(`Fetched ${count} products`)
  console.log('Products saved to data/products.json')
}

fetchBtsProducts()
