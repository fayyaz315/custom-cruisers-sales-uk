const axios = require('axios')
require('dotenv').config()

const getCountries = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getCountries`

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.TOKEN}` }
  })

  console.log(response.data)
}

getCountries()
