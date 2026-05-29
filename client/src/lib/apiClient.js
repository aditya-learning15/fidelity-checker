import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
})

export default apiClient
