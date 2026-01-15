const axios = require('axios')
const qs = require('qs')
require('dotenv').config()

const setCreateOrder = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/setCreateOrder`

  const body = qs.stringify({
    payment_method: 'wallet',
    'products[0][sku]': '123456',
    'products[0][quantity]': 1,
    shipping_cost_id: '123',
    client_name: 'John Doe',
    telephone: '123456789'
  })

  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${process.env.TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })

  console.log(response.data)
}

setCreateOrder()
