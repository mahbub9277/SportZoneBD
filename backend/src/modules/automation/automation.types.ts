import type {
  AutomationJob as PrismaAutomationJobModel,
  AutomationLog as PrismaAutomationLogModel,
} from '@prisma/client'

// Define AutomationStatus to match the structure returned by getAutomationStatus API endpoint
// This includes the job details and a list of its recent logs.
export type AutomationStatus = PrismaAutomationJobModel & {
  logs: PrismaAutomationLogModel[]
}

// Define AutomationMetrics as an aggregate type used for dashboard statistics.
// This type is not directly a Prisma model.
export interface AutomationMetrics {
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  lastRunAt?: Date | null // Prisma's Date type, can be null
  matchesCreatedLast24h: number
  streamsValidatedLast24h: number
  jobStatus: string // Reflects the status from the AutomationJob model
  isEnabled: boolean // Reflects the isEnabled status from the AutomationJob model
}

// Re-export AutomationLog directly from Prisma with the desired name
export type AutomationLog = PrismaAutomationLogModel