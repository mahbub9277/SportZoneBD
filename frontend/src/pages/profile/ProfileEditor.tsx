import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useUpdateProfileMutation } from '../../features/auth/auth.api.ts';
import { useAppSelector } from '../../app/hooks';
import { selectCurrentUser } from '../../features/auth/auth.slice';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/Card.tsx';
import { Label } from '../../components/ui/Label.tsx';
import { Input } from '../../components/ui/Input.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Spinner } from '../../components/ui/Spinner.tsx';

// 1. Define the Zod schema for form validation
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const profileSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters long.'),
  avatar: z // The `z.any()` type is used for file inputs in react-hook-form
    .any()
    .refine(
      (files: FileList) => !files || files.length === 0 || files[0].size <= MAX_FILE_SIZE,
      `Max image size is 5MB.`,
    )
    .refine(
      (files: FileList) => !files || files.length === 0 || ACCEPTED_IMAGE_TYPES.includes(files[0].type),
      'Only .jpg, .jpeg, .png and .webp formats are supported.'
    ),
});

// 2. Infer the form input type from the schema
type IFormInput = z.infer<typeof profileSchema>;

export function ProfileEditor() {
  const [updateProfile, { isLoading }] = useUpdateProfileMutation();
  
  const currentUser = useAppSelector(selectCurrentUser);

  // 3. Initialize React Hook Form with the Zod resolver
  const { register, handleSubmit, reset, formState: { isDirty, errors } } = useForm<IFormInput>({
    defaultValues: {
      fullName: currentUser?.fullName ?? '',
    },
    resolver: zodResolver(profileSchema),
  });

  const onSubmit: SubmitHandler<IFormInput> = async (data) => {
    if (!currentUser) return;

    const formData = new FormData();
    formData.append('fullName', data.fullName);
    if (data.avatar && data.avatar.length > 0) {
      formData.append('avatar', data.avatar[0]);
    }

    try {
      // Trigger the mutation and get the updated user data on success
      const updatedUser = await updateProfile(formData).unwrap();

      // Reset the form with the new data to update defaultValues and clear the dirty state
      reset({
        fullName: updatedUser.fullName ?? '',
        avatar: undefined, // Clear the file input
      });
      toast.success('Profile updated successfully!');
    } catch (err) {
      // Errors are automatically handled by the RTK Query hook, but you can add custom logic here if needed.
      console.error('Failed to update profile:', err);
      toast.error('Failed to update profile. Please try again.');
    }
  };

  return (
    <div className="app-page">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}><Card className="app-page-card w-full max-w-2xl overflow-hidden rounded-panel border border-slate-200/80 bg-white/90 shadow-premium backdrop-blur transition-colors duration-300 dark:border-slate-700/80 dark:bg-slate-950/90 dark:shadow-black/40">
      <CardHeader className="space-y-2 px-5 pt-5 sm:px-8 sm:pt-8">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-blue-500 to-cyan-400 px-4 py-1 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20">
          Profile Studio
        </motion.div>
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }} className="text-2xl font-semibold text-slate-900 dark:text-slate-100 sm:text-3xl">Edit Profile</motion.h1>
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="text-slate-600 dark:text-slate-400">
          Update your displayed name and avatar to keep your profile looking sharp in both light and dark mode.
        </motion.p>
      </CardHeader>
      <motion.form initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }} onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="space-y-6 px-5 pb-6 sm:px-8">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }} className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              type="text"
              {...register('fullName')}
              disabled={isLoading}
              className="transition duration-200 focus:ring-2 focus:ring-cyan-500/40 dark:bg-slate-900 dark:text-slate-100"
            />
            {errors.fullName && <p className="text-sm text-red-500 mt-1">{errors.fullName.message}</p>}
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="space-y-2">
            <Label htmlFor="avatar">Change Avatar</Label>
            <Input
              id="avatar"
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              {...register('avatar')}
              disabled={isLoading}
              className="file:mr-4 file:rounded-full file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800 dark:file:bg-slate-200 dark:file:text-slate-900 dark:hover:file:bg-slate-300"
            />
            {errors.avatar && <p className="text-sm text-red-500 mt-1">{errors.avatar.message?.toString()}</p>}
          </motion.div>
        </CardContent>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}><CardFooter className="flex items-center justify-end gap-3 px-5 pb-6 sm:px-8">
          <Button
            type="submit"
            disabled={isLoading || !isDirty}
            isLoading={isLoading}
            className="ml-auto w-full rounded-2xl bg-linear-to-r from-blue-600 to-cyan-500 px-6 py-3 text-white shadow-xl shadow-cyan-500/20 transition duration-300 hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
          >
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardFooter></motion.div>
      </motion.form>
      </Card></motion.div>
    </div>
  );
}