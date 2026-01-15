const axios = require('axios')
const fs = require('fs')
const path = require('path')
require('dotenv').config()

const saveCategories = async () => {
  const url = `${process.env.BTS_BASE_URL}/v1/api/getListCategories`

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.TOKEN}` }
  })

  const folderPath = path.resolve('data')
  const filePath = path.join(folderPath, 'categories.json')

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath)
  }

  fs.writeFileSync(filePath, JSON.stringify(response.data, null, 2))
}

saveCategories()
