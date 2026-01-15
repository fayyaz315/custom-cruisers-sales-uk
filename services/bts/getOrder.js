const axios = require('axios')
require('dotenv').config()

const getOrder = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getOrder`

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.TOKEN}` },
    params: { order_number: 'ORDER123' }
  })

  console.log(response.data)
}

getOrder()
