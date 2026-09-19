import type { CorsOptions } from 'cors'

const parseOrigins = (value?: string) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const configuredOrigins = [
  ...parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
  ...parseOrigins(process.env.FRONTEND_URL),
  ...parseOrigins(process.env.BASE_URL),
].map((url) => url.replace(/\/+$/, ''))

const developmentOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
]

const allowedOrigins = Array.from(
  new Set([
    ...configuredOrigins,
    ...developmentOrigins,
    'https://sport-zone-bd.vercel.app',
  ])
)

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    const cleanOrigin = origin.replace(/\/+$/, '')

    if (allowedOrigins.includes(cleanOrigin)) {
      callback(null, true)
      return
    }

    callback(null, true)
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 204,
}