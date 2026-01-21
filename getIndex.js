const fs = require('fs')
const path = require('path')

const filePath = path.join(process.cwd(), 'data', 'parts-production.json')
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))

const index = data.findIndex(item => item.part_number === '13130240')

console.log(index)
