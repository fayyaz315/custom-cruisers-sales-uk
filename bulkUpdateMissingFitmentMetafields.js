const fs = require("fs")
const path = require("path")

const dataDirectory =
  path.join(
    __dirname,
    "shopify-fitments-data"
  )

const inputFile =
  path.join(
    dataDirectory,
    "products-missing-fitments.jsonl"
  )

const outputFile =
  path.join(
    dataDirectory,
    "missing-fitments-update.jsonl"
  )

function safeJsonParse(
  value
) {
  try {
    return JSON.parse(value)
  } catch {
    return []
  }
}

function stringifyList(
  values
) {
  return JSON.stringify(
    [
      ...new Set(
        values
          .map(value =>
            String(
              value
            ).trim()
          )
          .filter(Boolean)
      )
    ].slice(0, 128)
  )
}

function extractFitmentData(
  fitments
) {
  const ids = []
  const vehicleIds = []
  const information = []

  for (const fitment of fitments) {
    if (fitment.id) {
      ids.push(
        fitment.id
      )
    }

    if (
      fitment.vehicle_id
    ) {
      vehicleIds.push(
        fitment.vehicle_id
      )
    }

    const info = []

    if (fitment.make) {
      info.push(
        fitment.make
      )
    }

    if (fitment.model) {
      info.push(
        fitment.model
      )
    }

    if (fitment.year) {
      info.push(
        fitment.year
      )
    }

    if (
      info.length > 0
    ) {
      information.push(
        info.join(" ")
      )
    }
  }

  return {
    ids,
    vehicleIds,
    information
  }
}

async function run() {
  console.log(
    "\nCREATING UPDATE JSONL\n"
  )

  const readStream =
    fs.createReadStream(
      inputFile,
      {
        encoding: "utf8"
      }
    )

  const writeStream =
    fs.createWriteStream(
      outputFile
    )

  let buffer = ""

  let processed = 0
  let updated = 0

  readStream.on(
    "data",
    chunk => {
      buffer += chunk

      const lines =
        buffer.split("\n")

      buffer =
        lines.pop()

      for (const line of lines) {
        if (!line.trim()) {
          continue
        }

        try {
          processed++

          const product =
            JSON.parse(
              line
            )

          const fitments =
            safeJsonParse(
              product
                .partFitments
                ?.value
            )

          if (
            !Array.isArray(
              fitments
            ) ||
            fitments.length ===
              0
          ) {
            continue
          }

          const extracted =
            extractFitmentData(
              fitments
            )

          const metafields =
            []

          if (
            !product.idsList
              ?.value &&
            extracted.ids
              .length > 0
          ) {
            metafields.push({
              ownerId:
                product.id,

              namespace:
                "fitments",

              key:
                "ids_list",

              type:
                "list.single_line_text_field",

              value:
                stringifyList(
                  extracted.ids
                )
            })
          }

          if (
            !product
              .vehicleIdsList
              ?.value &&
            extracted
              .vehicleIds
              .length > 0
          ) {
            metafields.push({
              ownerId:
                product.id,

              namespace:
                "fitments",

              key:
                "vehicle_ids_list",

              type:
                "list.single_line_text_field",

              value:
                stringifyList(
                  extracted.vehicleIds
                )
            })
          }

          if (
            !product
              .informationList
              ?.value &&
            extracted
              .information
              .length > 0
          ) {
            metafields.push({
              ownerId:
                product.id,

              namespace:
                "fitments",

              key:
                "information_list",

              type:
                "list.single_line_text_field",

              value:
                stringifyList(
                  extracted.information
                )
            })
          }

          if (
            metafields.length ===
            0
          ) {
            continue
          }

          writeStream.write(
            JSON.stringify({
              metafields
            }) + "\n"
          )

          updated++

          if (
            processed %
              1000 ===
            0
          ) {
            console.log(
              `Processed: ${processed}`
            )
          }
        } catch (error) {
          console.log(
            error.message
          )
        }
      }
    }
  )

  readStream.on(
    "end",
    () => {
      writeStream.end()

      console.log(
        `\nProcessed: ${processed}`
      )

      console.log(
        `Updates prepared: ${updated}`
      )

      console.log(
        `Saved:\n${outputFile}`
      )
    }
  )
}

run()