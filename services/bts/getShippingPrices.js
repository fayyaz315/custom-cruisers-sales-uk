const axios = require('axios')
require('dotenv').config()

const getShippingPrices = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getShippingPrices`

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.TOKEN}` },
    params: {
      'address[country_code]': 'FR',
      'address[postal_code]': '75001',
      'products[0][sku]': '123456',
      'products[0][quantity]': 1
    }
  })

  console.log(response.data)
}

getShippingPrices()
