const mongoose = require('mongoose')

const BlogPostSchema = new mongoose.Schema({
  title: String,
  url: String,
  summary: String,
  description: String,
  pubDate: Date,
  status: { type: String, default: 'pending' }, // pending, approved, rejected
  createdAt: { type: Date, default: Date.now }
})

module.exports = mongoose.model('BlogPost', BlogPostSchema)
