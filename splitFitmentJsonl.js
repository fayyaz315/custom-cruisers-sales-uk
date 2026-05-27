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
    "missing-fitments-update.jsonl"
  )

const CHUNK_SIZE = 2000

async function run() {
  console.log(
    "\nSPLITTING JSONL\n"
  )

  const readStream =
    fs.createReadStream(
      inputFile,
      {
        encoding: "utf8"
      }
    )

  let buffer = ""

  let chunkLines = []
  let chunkNumber = 1
  let processed = 0

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

        processed++

        chunkLines.push(line)

        if (
          chunkLines.length >=
          CHUNK_SIZE
        ) {
          const outputFile =
            path.join(
              dataDirectory,
              `missing-fitments-update-${chunkNumber}.jsonl`
            )

          fs.writeFileSync(
            outputFile,
            chunkLines.join(
              "\n"
            ),
            "utf8"
          )

          console.log(
            `Chunk ${chunkNumber} created | ${chunkLines.length} records`
          )

          chunkLines = []

          chunkNumber++
        }

        if (
          processed % 1000 ===
          0
        ) {
          console.log(
            `Processed: ${processed}`
          )
        }
      }
    }
  )

  readStream.on(
    "end",
    () => {
      if (
        chunkLines.length >
        0
      ) {
        const outputFile =
          path.join(
            dataDirectory,
            `missing-fitments-update-${chunkNumber}.jsonl`
          )

        fs.writeFileSync(
          outputFile,
          chunkLines.join(
            "\n"
          ),
          "utf8"
        )

        console.log(
          `Final chunk ${chunkNumber} created | ${chunkLines.length} records`
        )
      }

      console.log(
        `\nTotal processed: ${processed}`
      )

      console.log(
        "\nJSONL SPLIT COMPLETED\n"
      )
    }
  )
}

run()