const axios = require('axios')
require('dotenv').config()

const getPointRelais = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getPointRelais`

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.TOKEN}` },
    params: {
      'address[city]': 'Paris',
      'address[postal_code]': '75001',
      'address[country_code]': 'FR'
    }
  })

  console.log(response.data)
}

getPointRelais()
