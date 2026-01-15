const axios = require('axios')
require('dotenv').config()

const getStatesByCountryCode = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getStatesByCountryCode`

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.TOKEN}` },
    params: { country_code: 'US' }
  })

  console.log(response.data)
}

getStatesByCountryCode()
