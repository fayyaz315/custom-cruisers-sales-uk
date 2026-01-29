const express = require('express')
const { syncToShopify } = require('./sync-to-shopify')

const app = express()
const PORT = process.env.PORT || 3000

let isSyncing = false
let syncInterval = null

app.use(express.json())

app.post('/api/sync/start', async (req, res) => {
  if (isSyncing) {
    return res.json({ message: 'Sync already running' })
  }
  
  isSyncing = true
  res.json({ message: 'Sync started' })
  
  syncInterval = setInterval(async () => {
    if (!isSyncing) {
      clearInterval(syncInterval)
      return
    }
    
    try {
      const result = await syncToShopify()
      
      if (result.complete) {
        console.log('✅ Sync complete!')
        isSyncing = false
        clearInterval(syncInterval)
      } else if (result.dailyLimitReached) {
        console.log('🛑 Daily limit reached - stopping sync')
        isSyncing = false
        clearInterval(syncInterval)
      }
    } catch (e) {
      console.error('Sync error:', e.message)
    }
  }, 3000)
})

app.post('/api/sync/stop', (req, res) => {
  isSyncing = false
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
  }
  res.json({ message: 'Sync stopped' })
})

app.get('/api/sync/status', (req, res) => {
  res.json({ syncing: isSyncing })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})