import type { Express } from 'express'
import { uploadStreamToCloudinary } from '../../services/upload.service.js'

type UploadedFiles = { [fieldname: string]: Express.Multer.File[] } | undefined

export async function handleMatchFileUploads(
  files: UploadedFiles,
): Promise<{ homeTeamLogo?: string; awayTeamLogo?: string }> {
  const uploadedImageUrls: { homeTeamLogo?: string; awayTeamLogo?: string } = {}

  if (!files) {
    return uploadedImageUrls
  }

  const uploadPromises: Promise<void>[] = []

  if (files.homeTeamLogo?.[0]?.buffer) {
    uploadPromises.push(
      (async () => {
        const newUrl = await uploadStreamToCloudinary(files.homeTeamLogo[0].buffer, 'sportzone/team-logos')
        if (newUrl) {
          uploadedImageUrls.homeTeamLogo = newUrl
        }
      })(),
    )
  }

  if (files.awayTeamLogo?.[0]?.buffer) {
    uploadPromises.push(
      (async () => {
        const newUrl = await uploadStreamToCloudinary(files.awayTeamLogo[0].buffer, 'sportzone/team-logos')
        if (newUrl) {
          uploadedImageUrls.awayTeamLogo = newUrl
        }
      })(),
    )
  }

  await Promise.all(uploadPromises)

  return uploadedImageUrls
}