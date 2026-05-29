import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 300000, // 5 minutes — Figma export + AI analysis can take 2-3 min
})

export default apiClient
