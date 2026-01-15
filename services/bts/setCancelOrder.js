const axios = require('axios')
const qs = require('qs')
require('dotenv').config()

const setCancelOrder = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/setCancelOrder`

  const body = qs.stringify({
    order_number: 'ORDER123'
  })

  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${process.env.TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })

  console.log(response.data)
}

setCancelOrder()
