const fs = require('fs')
const path = require('path')

const sourcePath = path.join(__dirname, '../../data/categories.json')
const outputPath = path.join(__dirname, '../../data/unique_categories.json')

const raw = fs.readFileSync(sourcePath, 'utf8')
const data = JSON.parse(raw)

const unique = Object.values(data)

const result = {
  count: unique.length,
  categories: unique
}

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8')
console.log('Unique categories saved with count:', unique.length)
