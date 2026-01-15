const fs = require('fs')
const path = require('path')
const axios = require('axios')
const Progress = require('../models/Progress')
require('dotenv').config()

const uploadProducts = async () => {
  let progress = await Progress.findOne()
  if (!progress) progress = await Progress.create({ index: 0 })

  const startIndex = progress.index

  const productsPath = path.resolve('data/products.json')
  const categoriesPath = path.resolve('data/categories.json')

  const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'))
  const categories = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'))

  const total = products.length

  for (let i = startIndex; i < total; i++) {
    const item = products[i]

    const rawCats = typeof item.categories === 'string' ? item.categories : ''
    const categoryIds = rawCats.length ? rawCats.split('/') : []

    const categoryNames = categoryIds
      .map(id => categories[id] ? categories[id].name : null)
      .filter(Boolean)

    const mainCategory = categoryNames[0] || ''

    const tagList = [
      item.gender,
      ...categoryNames
    ].filter(Boolean).join(',')

    const body = {
      product: {
        title: item.name,
        vendor: item.manufacturer,
        body_html: item.description || '',
        product_type: mainCategory,
        tags: tagList,
        variants: [
          {
            price: item.recommended_price.replace('€', ''),
            cost: item.price.replace('€', ''),
            sku: item.ean,
            barcode: item.ean,
            inventory_quantity: Number(item.stock),
            inventory_management: 'shopify',
            taxable: false
          }
        ],
        images: [
          { src: item.image }
        ]
      }
    }

    try {
      await axios.post(
        `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2023-07/products.json`,
        body,
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      )

      progress.index = i + 1
      await progress.save()

      const done = i + 1
      const left = total - done
      console.log(`Uploaded: ${done}/${total} | Left: ${left}`)
    } catch (err) {
      console.log('Stopped at index:', i)
      console.log('Error:', err.response ? err.response.data : err)
      progress.index = i
      await progress.save()
      throw err
    }
  }

  console.log('All products uploaded')
  progress.index = total
  await progress.save()
}

module.exports = uploadProducts
