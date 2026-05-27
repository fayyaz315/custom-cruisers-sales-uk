const fs = require("fs")
const path = require("path")
const readline = require("readline")

const taxonomyFilePath = path.join(
  __dirname,
  "shopify-taxonomy-data",
  "shopify-vehicle-taxonomy.json"
)

const productsFilePath = path.join(
  __dirname,
  "shopify-missing-categories",
  "products-missing-categories.jsonl"
)

const outputDirectory = path.join(
  __dirname,
  "shopify-taxonomy-data"
)

if (!fs.existsSync(outputDirectory)) {
  fs.mkdirSync(outputDirectory, {
    recursive: true
  })
}

const matchedOutputFilePath = path.join(
  outputDirectory,
  "products-missing-categories-matched.jsonl"
)

const ignoredWords = [
  "kit",
  "set",
  "assembly",
  "attachment",
  "hardware",
  "component",
  "parts",
  "part",
  "each",
  "system",
  "universal",
  "complete",
  "standard",
  "moose",
  "offroad",
  "hard",
  "mse",
  "motor",
  "mtr",
  "and",
  "the"
]

const learnedMappings = {
  "grip":
    "motorcycle grips",

  "grips":
    "motorcycle grips",

  "lens":
    "helmet",

  "visor":
    "helmet",

  "shield":
    "helmet",

  "pinlock":
    "helmet",

  "helmet":
    "helmet",

  "extension":
    "handlebar",

  "handlebar":
    "handlebar",

  "bar":
    "handlebar",

  "boot":
    "boots",

  "flywheel":
    "flywheel",

  "relay":
    "relay",

  "jet":
    "jet",

  "watercraft":
    "watercraft",

  "case":
    "luggage",

  "bag":
    "luggage",

  "luggage":
    "luggage",

  "pump":
    "pump",

  "shaft":
    "shaft",

  "bearing":
    "bearing",

  "ring":
    "ring",

  "fuel":
    "fuel",

  "valve":
    "valve",

  "cover":
    "cover",

  "piston":
    "piston",

  "clutch":
    "clutch",

  "brake":
    "brake",

  "filter":
    "filter",

  "cable":
    "cable",

  "radiator":
    "radiator",

  "fender":
    "fender",

  "seat":
    "seat",

  "wheel":
    "wheel",

  "tire":
    "tire",

  "tyre":
    "tire",

  "pipe":
    "exhaust",

  "exhaust":
    "exhaust",

  "mirror":
    "mirror",

  "lever":
    "lever",

  "switch":
    "switch",

  "spark":
    "spark plug",

  "plug":
    "spark plug",

  "gasket":
    "gasket",

  "gskt":
    "gasket",

  "sls":
    "gasket",

  "chain":
    "chain",

  "sprocket":
    "sprocket",

  "battery":
    "battery",

  "oil":
    "oil",

  "air":
    "air filter",

  "fork":
    "fork",

  "shock":
    "shock absorber",

  "fairing":
    "fairing"
}

const fallbackCategory = {
  categoryId:
    "gid://shopify/TaxonomyCategory/vp-1",

  categoryName:
    "Vehicle Parts & Accessories",

  categoryFullName:
    "Vehicles & Parts > Vehicle Parts & Accessories",

  score: 1
}

function log(message, data = null) {
  const time = new Date().toLocaleString()

  console.log(`\n[${time}] ${message}`)

  if (data) {
    console.log(
      JSON.stringify(
        data,
        null,
        2
      )
    )
  }
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\//g, " ")
    .replace(/-/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function loadTaxonomy() {
  log("======================================")
  log("LOADING TAXONOMY")
  log("======================================")

  const raw =
    fs.readFileSync(
      taxonomyFilePath,
      "utf8"
    )

  const parsed =
    JSON.parse(raw)

  const taxonomy =
    parsed.map(category => {
      const normalizedName =
        normalize(
          category.name
        )

      const normalizedFullName =
        normalize(
          category.fullName
        )

      return {
        id:
          category.id,

        name:
          category.name,

        fullName:
          category.fullName,

        normalizedName,

        normalizedFullName,

        words:
          normalizedName.split(
            " "
          ),

        level:
          category.level,

        isLeaf:
          category.isLeaf
      }
    })

  log(
    "Taxonomy loaded",
    {
      categories:
        taxonomy.length
    }
  )

  return taxonomy
}

function getWords(text) {
  return normalize(text)
    .split(" ")
    .filter(
      word =>
        word.length >= 2 &&
        !ignoredWords.includes(
          word
        )
    )
}

function extractKeywords(
  title,
  productName
) {
  const titleWords =
    getWords(title)

  const productNameWords =
    getWords(productName)

  const allWords = [
    ...productNameWords,
    ...titleWords
  ]

  const expandedWords = []

  for (const word of allWords) {
    expandedWords.push(word)

    if (
      learnedMappings[word]
    ) {
      expandedWords.push(
        learnedMappings[word]
      )
    }
  }

  return [
    ...new Set(
      expandedWords
    )
  ]
}

function applyPenalty(
  category
) {
  const fullName =
    category.normalizedFullName

  let penalty = 0

  const badVerticals = [
    "health and beauty",
    "office supplies",
    "toys and games",
    "pet supplies",
    "food beverages",
    "furniture",
    "electronics",
    "jewelry",
    "clothing",
    "sporting goods"
  ]

  for (const bad of badVerticals) {
    if (
      fullName.includes(bad)
    ) {
      penalty += 50000
    }
  }

  if (
    fullName.includes(
      "vehicles and parts"
    )
  ) {
    penalty -= 25000
  }

  return penalty
}

function scoreCategory(
  keywords,
  category
) {
  let score = 0

  for (const keyword of keywords) {
    if (
      category.words.includes(
        keyword
      )
    ) {
      score += 5000
    }

    if (
      category.normalizedName.includes(
        keyword
      )
    ) {
      score += 3000
    }

    if (
      category.normalizedFullName.includes(
        keyword
      )
    ) {
      score += 1000
    }
  }

  if (
    category.normalizedFullName.includes(
      "vehicles and parts"
    )
  ) {
    score += 15000
  }

  if (
    category.isLeaf
  ) {
    score += 5000
  }

  score -= applyPenalty(
    category
  )

  return score
}

function findCategory(
  title,
  productName,
  taxonomy
) {
  const keywords =
    extractKeywords(
      title,
      productName
    )

  let bestCategory = null
  let highestScore = -999999

  for (const category of taxonomy) {
    const score =
      scoreCategory(
        keywords,
        category
      )

    if (
      score >
      highestScore
    ) {
      highestScore =
        score

      bestCategory = {
        categoryId:
          category.id,

        categoryName:
          category.name,

        categoryFullName:
          category.fullName,

        score
      }
    }
  }

  if (bestCategory) {
    return bestCategory
  }

  return fallbackCategory
}

async function matchProducts() {
  log("======================================")
  log("MATCHING PRODUCTS")
  log("======================================")

  const taxonomy =
    loadTaxonomy()

  const readStream =
    fs.createReadStream(
      productsFilePath
    )

  const rl =
    readline.createInterface({
      input: readStream,
      crlfDelay: Infinity
    })

  const matchedResults = []

  let processedProducts = 0
  let matchedProducts = 0

  for await (const line of rl) {
    try {
      if (!line.trim()) {
        continue
      }

      const item =
        JSON.parse(line)

      processedProducts++

      const bestCategory =
        findCategory(
          item.title,
          item.productName,
          taxonomy
        )

      matchedProducts++

      const formatted = {
        productId:
          item.productId,

        title:
          item.title,

        productName:
          item.productName,

        categoryId:
          bestCategory.categoryId,

        categoryName:
          bestCategory.categoryName,

        categoryFullName:
          bestCategory.categoryFullName,

        score:
          bestCategory.score
      }

      matchedResults.push(
        JSON.stringify(
          formatted
        )
      )

      log(
        "Matched category",
        formatted
      )

      if (
        processedProducts %
          1000 ===
        0
      ) {
        log(
          "Matching progress",
          {
            processedProducts,
            matchedProducts
          }
        )
      }
    } catch (error) {
      log(
        "Failed matching product"
      )

      console.log(
        error.message
      )
    }
  }

  fs.writeFileSync(
    matchedOutputFilePath,
    matchedResults.join("\n")
  )

  const matchedStats =
    fs.statSync(
      matchedOutputFilePath
    )

  log(
    "Matching completed",
    {
      processedProducts,
      matchedProducts,

      matchedFile:
        matchedOutputFilePath,

      matchedFileSize:
        matchedStats.size
    }
  )
}

async function run() {
  log("======================================")
  log("SHOPIFY VEHICLE CATEGORY MATCHER STARTED")
  log("======================================")

  await matchProducts()

  log("======================================")
  log("SHOPIFY VEHICLE CATEGORY MATCHER FINISHED")
  log("======================================")
}

run()