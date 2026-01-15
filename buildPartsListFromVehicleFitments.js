const fs = require("fs")
const path = require("path")

const DATA_DIR = path.join(__dirname, "data")
const INPUT_FILE = path.join(DATA_DIR, "vehicle-fitments-sandbox.json")
const OUTPUT_FILE = path.join(DATA_DIR, "parts-sandbox.json")

function buildPartsList() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error("vehicle-fitments-sandbox.json not found")
  }

  const fitments = JSON.parse(fs.readFileSync(INPUT_FILE, "utf8"))

  const uniqueParts = new Map()

  for (const f of fitments) {
    const partNumber = f.part_number || f.partNumber || f.number
    if (!partNumber) continue

    if (!uniqueParts.has(partNumber)) {
      uniqueParts.set(partNumber, {
        part_number: partNumber
      })
    }
  }

  const partsArray = Array.from(uniqueParts.values())

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(partsArray, null, 2),
    "utf8"
  )

  console.log(`Parts list created: ${partsArray.length} parts`)
  console.log(`Saved to ${OUTPUT_FILE}`)
}

buildPartsList()
