const axios = require('axios')
require('dotenv').config()

const getProducts = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getProducts`

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.TOKEN}` },
    params: {
      'product_sku[0]': 3701145601264
    }
  })

  console.log(response.data)
}

getProducts()
