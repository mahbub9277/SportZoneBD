import { useState, useEffect, useCallback } from 'react'
import { useForm, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { AnimatePresence, motion } from 'framer-motion'
import Cropper, { type Area } from 'react-easy-crop'
import { X, UploadCloud, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Input } from '../../../components/ui/Input'
import type { User } from '../../../features/auth/auth.types'
import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { Avatar, AvatarFallback, AvatarImage } from '../../../components/ui/Avatar'
import { Spinner } from '../../../components/ui/Spinner'
import { Label } from '../../../components/ui/Label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../../components/ui/Dialog'
import { Slider } from '../../../components/ui/Slider'
import getCroppedImg from '../../../utils/cropImage'

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

const profileSchema = z.object({
  fullName: z.string().min(3, 'Full name must be at least 3 characters.'),
  email: z.string().email(),
  avatarFile: z
    .any()
    .refine((file) => !file || file.size <= MAX_FILE_SIZE, `Max file size is 5MB.`)
    .refine(
      (file) => !file || ACCEPTED_IMAGE_TYPES.includes(file.type),
      ".jpg, .jpeg, .png and .webp files are accepted."
    )
    .optional(),
});

type ProfileFormValues = z.infer<typeof profileSchema>

interface EditProfileFormProps {
  user: User
  onSubmit: (formData: FormData) => { abort: () => void };
  isLoading: boolean
  onCancel: () => void;
}

export function EditProfileForm({ user, onSubmit, isLoading, onCancel }: EditProfileFormProps) {
  // State for image cropping
  const [imageToCrop, setImageToCrop] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)

  // State for the UI
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(user.avatar ? buildCloudinaryUrl(user.avatar) : null);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: user.fullName || '',
      email: user.email || '',
      avatarFile: undefined,
    },
  })

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0]
      // Validate file with Zod before opening cropper
      const validation = profileSchema.shape.avatarFile.safeParse(file)
      if (!validation.success) {
        form.setError('avatarFile', { message: validation.error.issues[0].message })
        return
      }
      setRemoveAvatar(false)
      setImageToCrop(URL.createObjectURL(file))
    }
  };

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleCrop = async () => {
    if (!imageToCrop || !croppedAreaPixels) return

    try {
      const croppedImageFile = await getCroppedImg(imageToCrop, croppedAreaPixels, rotation)
      if (croppedImageFile) {
        setSelectedFile(croppedImageFile)
        setPreviewUrl(URL.createObjectURL(croppedImageFile))
        form.setValue('avatarFile', croppedImageFile, { shouldValidate: true, shouldDirty: true })
      }
    } catch (e) {
      console.error(e)
    }
    setImageToCrop(null) // Close the modal
  }

  const handleRemovePreview = () => {
    setSelectedFile(null);
    setRemoveAvatar(true)
    setPreviewUrl(null);
    form.setValue('avatarFile', undefined, { shouldValidate: false, shouldDirty: true });
    form.resetField('avatarFile');
  };

  const handleFormSubmit: SubmitHandler<ProfileFormValues> = (values) => {
    const formData = new FormData();
    formData.append('fullName', values.fullName);
    if (selectedFile) {
      formData.append('avatar', selectedFile);
    }
    if (removeAvatar && !selectedFile) {
      formData.append('removeAvatar', 'true')
    }
    onSubmit(formData);
  };

  // Clean up the object URL to prevent memory leaks
  useEffect(() => {
    const currentPreview = previewUrl
    return () => {
      if (currentPreview && currentPreview.startsWith('blob:')) {
        URL.revokeObjectURL(currentPreview);
      }
    };
  }, [previewUrl]);

  return (
    <>
      <Dialog open={!!imageToCrop} onOpenChange={(open) => !open && setImageToCrop(null)}>
        <DialogContent className="max-w-lg p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>Crop & Rotate Image</DialogTitle>
          </DialogHeader>
          <div className="relative h-80 w-full">
            <Cropper
              image={imageToCrop!}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={onCropComplete}
            />
          </div>
          <DialogFooter className="flex-col gap-4 p-6">
            <div className="space-y-2">
              <Label>Zoom</Label>
              <div className="flex items-center gap-2">
                <motion.div whileHover={{ scale: 1.1 }}>
                  <ZoomOut size={16} />
                </motion.div>
                <Slider value={[zoom]} min={1} max={3} step={0.1} onValueChange={(val) => setZoom(val[0])} />
                <motion.div whileHover={{ scale: 1.1 }}>
                  <ZoomIn size={16} />
                </motion.div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rotation</Label>
              <div className="flex items-center gap-2">
                <motion.div whileHover={{ scale: 1.1, rotate: 180 }}>
                  <RotateCw size={16} className="-scale-x-100" />
                </motion.div>
                <Slider value={[rotation]} min={0} max={360} step={1} onValueChange={(val) => setRotation(val[0])} />
                <motion.div whileHover={{ scale: 1.1, rotate: 360 }}>
                  <RotateCw size={16} />
                </motion.div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setImageToCrop(null)}>Cancel</Button>
              <Button onClick={handleCrop}>Apply Crop</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Form {...form}>
        <motion.form initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} id="edit-profile-form" onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6 pt-4" noValidate>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="h-24 w-24">
                <AvatarImage src={previewUrl ?? undefined} alt="Avatar Preview" />
                <AvatarFallback name={user.fullName || user.email || ''} className="text-3xl" />
              </Avatar>
              <AnimatePresence>
                {previewUrl && selectedFile && (
                  <motion.button
                    type="button"
                    onClick={handleRemovePreview}
                    className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-red-500/50 bg-red-500 text-white"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <motion.div whileHover={{ rotate: 90 }}>
                      <X size={14} />
                    </motion.div>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="avatar-upload">Change Avatar (Max 5MB)</Label>
              <Input id="avatar-upload" type="file" accept="image/*" onChange={handleFileChange} />
              <FormMessage>{form.formState.errors.avatarFile?.message as React.ReactNode}</FormMessage>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>
            <FormField control={form.control} name="fullName" render={({ field }) => (
              <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} type="text" /></FormControl><FormMessage /></FormItem>
            )} />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel>Email (cannot be changed)</FormLabel><FormControl><Input {...field} readOnly disabled /></FormControl><FormMessage /></FormItem>
            )} />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }} className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading || !form.formState.isDirty}>
              {isLoading && <Spinner className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </motion.div>
        </motion.form>
      </Form>
    </>
  )
}