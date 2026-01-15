const axios = require('axios')
require('dotenv').config()

const getTrackings = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getTrackings`

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.TOKEN}` },
    params: {
      'order_number[0]': 'ORDER123'
    }
  })

  console.log(response.data)
}

getTrackings()
