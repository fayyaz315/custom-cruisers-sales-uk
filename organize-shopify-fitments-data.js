const fs = require("fs")
const path = require("path")
const readline = require("readline")

const dataDirectory = path.join(
  __dirname,
  "shopify-fitments-data"
)

const rawExportJsonlPath = path.join(
  dataDirectory,
  "products-fitments-export.jsonl"
)

const organizedJsonlPath = path.join(
  dataDirectory,
  "products-fitments-organized.jsonl"
)

function log(message, data = null) {
  const time = new Date().toLocaleString()

  console.log(`\n[${time}] ${message}`)

  if (data) {
    console.log(JSON.stringify(data, null, 2))
  }
}

async function organizeFitmentsData() {
  log("======================================")
  log("ORGANIZING FITMENTS DATA")
  log("======================================")

  if (
    !fs.existsSync(
      rawExportJsonlPath
    )
  ) {
    log(
      "Raw fitments export not found",
      {
        path:
          rawExportJsonlPath
      }
    )

    process.exit()
  }

  const readStream =
    fs.createReadStream(
      rawExportJsonlPath
    )

  const rl =
    readline.createInterface({
      input: readStream,
      crlfDelay: Infinity
    })

  const writeStream =
    fs.createWriteStream(
      organizedJsonlPath
    )

  let processedProducts = 0
  let skippedProducts = 0

  for await (const line of rl) {
    try {
      if (!line.trim()) {
        continue
      }

      const item =
        JSON.parse(line)

      if (
        !item.metafield ||
        !item.metafield.value
      ) {
        skippedProducts++

        continue
      }

      const fitments =
        JSON.parse(
          item.metafield.value
        )

      if (
        !Array.isArray(
          fitments
        ) ||
        fitments.length === 0
      ) {
        skippedProducts++

        continue
      }

      processedProducts++

      const ids =
        fitments
          .map(f => f.id)
          .filter(Boolean)

      const vehicleIds =
        fitments
          .map(
            f => f.vehicle_id
          )
          .filter(Boolean)

      const informationValues =
        [
          ...new Set(
            fitments
              .map(
                f =>
                  f.information
              )
              .filter(
                value =>
                  value &&
                  value !== "null"
              )
          )
        ]

      const partNumber =
        fitments.find(
          f =>
            f.part_number
        )?.part_number || null

      const organizedRecord = {
        productId:
          item.id,

        fitmentsCount:
          fitments.length,

        ids,

        vehicleIds,

        information:
          informationValues,

        partNumber
      }

      writeStream.write(
        JSON.stringify(
          organizedRecord
        ) + "\n"
      )

      log(
        "Organized fitments",
        {
          productId:
            item.id,

          totalFitments:
            fitments.length,

          totalVehicleIds:
            vehicleIds.length,

          partNumber
        }
      )

      if (
        processedProducts %
          1000 ===
        0
      ) {
        log(
          "Organization progress",
          {
            processedProducts,
            skippedProducts
          }
        )
      }
    } catch (error) {
      log(
        "Failed processing fitments line"
      )

      console.log(
        error.message
      )
    }
  }

  writeStream.end()

  log("======================================")
  log("FITMENTS ORGANIZATION FINISHED")
  log("======================================")

  log(
    "FINAL REPORT",
    {
      processedProducts,
      skippedProducts,
      outputFile:
        organizedJsonlPath
    }
  )
}

organizeFitmentsData()