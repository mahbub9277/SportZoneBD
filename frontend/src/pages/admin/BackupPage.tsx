import { useGetBackupsQuery, useCreateBackupMutation, useLazyGetBackupDownloadQuery } from '@/features/admin/system.api'
import type { Backup } from '@/features/admin/system.api'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { PlusCircle, HardDriveDownload } from 'lucide-react'
import { getErrorMessage } from '@/utils/get-error-message'
import { motion } from 'framer-motion'

const emptyBackups: Backup[] = []

function formatBytes(bytes: string, decimals = 2) {
  let bytesNum: bigint
  try {
    bytesNum = BigInt(bytes)
  } catch {
    return 'Unknown size'
  }
  if (bytesNum === 0n) return '0 Bytes'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']

  const i = Math.floor(Math.log(Number(bytesNum)) / Math.log(k))

  return `${parseFloat((Number(bytesNum) / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export default function BackupPage() {
  const backupsQuery = useGetBackupsQuery()
  const backups = backupsQuery.data ?? emptyBackups
  const { isLoading, isFetching } = backupsQuery
  const [createBackup, { isLoading: isCreating }] = useCreateBackupMutation()
  const [getBackupDownload, { isFetching: isDownloading }] = useLazyGetBackupDownloadQuery()

  const handleCreateBackup = async () => {
    toast.promise(createBackup().unwrap(), {
      loading: 'Starting new backup...',
      success: 'Backup created and uploaded to Cloudinary.',
      error: (err) => getErrorMessage(err),
    })
  }

  const handleDownload = async (backupId: string) => {
    try {
      const result = await getBackupDownload(backupId).unwrap()
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div>
          <h1 className="text-3xl font-semibold text-(--text-primary)">Backup Management</h1>
          <p className="mt-1 text-sm text-(--text-muted)">Create PostgreSQL backups and store them securely in Cloudinary.</p>
        </div>
        <Button onClick={handleCreateBackup} disabled={isCreating} className="w-full sm:w-auto">
          <motion.span whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><PlusCircle size={16} className="mr-2" /></motion.span>
          Create New Backup
        </Button>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} whileHover={{ y: -4 }}><Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Database Backups</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5}>Loading backups...</TableCell></TableRow>}
              {!isLoading && backups.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-text-muted">No backups created yet.</TableCell></TableRow>}
              {backups.map((backup) => (
                <TableRow key={backup.id}>
                  <TableCell className="max-w-64 truncate font-mono" title={backup.fileName}>{backup.fileName}</TableCell>
                  <TableCell>{formatBytes(backup.size)}</TableCell>
                  <TableCell><Badge variant={backup.status === 'COMPLETED' ? 'default' : backup.status === 'PENDING' ? 'secondary' : 'destructive'}>{backup.status}</Badge></TableCell>
                  <TableCell>{format(new Date(backup.createdAt), 'PPpp')}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" disabled={backup.status !== 'COMPLETED' || isDownloading} onClick={() => handleDownload(backup.id)}>
                      <motion.span whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><HardDriveDownload size={14} className="mr-2" /></motion.span> {isDownloading ? 'Preparing...' : 'Download'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card></motion.div>
    </motion.div>
  )
}