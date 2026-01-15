// models/SyncProgress.js
const mongoose = require("mongoose")

const SyncProgressSchema = new mongoose.Schema({
  last_index: { type: Number, default: 0 },
  last_part_number: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now }
})

module.exports = mongoose.model("SyncProgress", SyncProgressSchema)
