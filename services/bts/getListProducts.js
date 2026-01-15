const axios = require('axios')
require('dotenv').config()

const getListProducts = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getListProducts`

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.TOKEN}` }
  })

  console.log(response.data)
}

getListProducts()
