import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import analyzeRouter from './routes/analyze.js'

// Resolve .env relative to this file so it works regardless of which
// directory the process is started from (root or server/).
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// FIX D: Set 90s request timeout as safety net
// Primary control is 30s Gemini timeout + fail-fast retry logic.
// This catches runaway requests and prevents Fly.io auto-stop mid-flight.
app.use((req, res, next) => {
  req.setTimeout(90000)  // 90 seconds
  res.setTimeout(90000)
  next()
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/analyze', analyzeRouter)

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down gracefully')
  server.close(() => {
    console.log('HTTP server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('SIGINT received — shutting down gracefully')
  server.close(() => {
    console.log('HTTP server closed')
    process.exit(0)
  })
})
