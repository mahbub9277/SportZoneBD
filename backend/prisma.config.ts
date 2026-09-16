/// <reference types="node" />
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

const connectionUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL

if (!connectionUrl) {
  throw new Error('DIRECT_URL or DATABASE_URL must be set')
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: connectionUrl,
  },
})
