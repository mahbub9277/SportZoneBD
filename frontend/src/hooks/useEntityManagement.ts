import { useState, useCallback, useRef } from 'react'
import { type UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import type { TypedMutationTrigger } from '@reduxjs/toolkit/query/react'
import type { BaseQueryFn } from '@reduxjs/toolkit/query'

/**
 * Extracts a user-friendly error message from an RTK Query error object.
 * @param error The error object caught from a mutation.
 * @param fallbackMessage A fallback message if a specific one can't be found.
 * @returns A string containing the error message.
 */
function getApiErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data) {
      const errorData = error.data as { message?: unknown };
      if (typeof errorData.message === 'string') {
        return errorData.message;
      }
      // Handle cases where the error data itself is the message string
      if (typeof errorData === 'string') {
        return errorData;
      }
    }
    if ('error' in error && typeof error.error === 'string') {
      // Handle top-level error strings, common with fetchBaseQuery
      return error.error;
    }
  }
  return fallbackMessage;
}

/**
 * Represents a generic entity with an ID.
 * The `title` property is used for user-facing messages (e.g., toasts).
 */
interface Entity {
  id: string
  title?: string // Added optional title for toast messages
}

/**
 * A more generic and stable type for an RTK Query mutation hook.
 * It focuses on the trigger function and the result object.
 */
type RTKMutationHook<TArg, TResult> = () => readonly [
  TypedMutationTrigger<TResult, TArg, BaseQueryFn>,
  { isLoading: boolean }
];

/**
 * Configuration options for the useEntityManagement hook.
 */
interface UseEntityManagementOptions<TEntity extends Entity, TFormData extends object, TCreateData, TUpdateData> {
  entityName: string
  useCreateMutation: RTKMutationHook<TCreateData, TEntity>
  useUpdateMutation: RTKMutationHook<TUpdateData, TEntity>
  useDeleteMutation: RTKMutationHook<string, unknown>
  form: UseFormReturn<TFormData>
  entityToFormData: (entity: TEntity) => TFormData
  formDataToCreatePayload?: (formData: TFormData) => TCreateData
  formDataToUpdatePayload?: (formData: TFormData, id: string) => TUpdateData
}

/**
 * Represents the state of the management form.
 * - `idle`: The form is closed.
 * - `create`: The form is open for creating a new entity.
 * - `edit`: The form is open for editing an existing entity.
 */
type FormState<TEntity> =
  | { mode: 'idle' }
  | { mode: 'create' }
  | { mode: 'edit'; entity: TEntity };

export function useEntityManagement<TEntity extends Entity, TFormData extends object, TCreateData = TFormData, TUpdateData = TFormData & { id: string }>({
  entityName,
  useCreateMutation,
  useUpdateMutation,
  useDeleteMutation,
  form,
  entityToFormData,
  formDataToCreatePayload = (data) => data as unknown as TCreateData,
  formDataToUpdatePayload = (data, id) => ({ ...data, id }) as unknown as TUpdateData,
}: UseEntityManagementOptions<TEntity, TFormData, TCreateData, TUpdateData>) {
  const [formState, setFormState] = useState<FormState<TEntity>>({ mode: 'idle' });
  const [deletingEntity, setDeletingEntity] = useState<TEntity | null>(null)
  const submitInFlightRef = useRef(false)

  const [createEntityTrigger, { isLoading: isCreating }] = useCreateMutation()
  const [updateEntityTrigger, { isLoading: isUpdating }] = useUpdateMutation()
  const [deleteEntityTrigger] = useDeleteMutation()

  const isMutating = isCreating || isUpdating

  const handleCloseForm = useCallback(() => {
    setFormState({ mode: 'idle' });
    form.reset();
  }, [form])

  const handleOpenCreate = useCallback(() => {
    setFormState({ mode: 'create' });
    form.reset();
  }, [form])

  const handleOpenEdit = useCallback(
    (entity: TEntity) => {
      setFormState({ mode: 'edit', entity });
      form.reset(entityToFormData(entity))
    },
    [form, entityToFormData]
  )

  const handleSubmit = useCallback(
    async (formData: TFormData) => {
      if (submitInFlightRef.current) return
      submitInFlightRef.current = true

      try {
        if (formState.mode === 'edit') {
          const payload = formDataToUpdatePayload(formData, formState.entity.id);
          await updateEntityTrigger(payload).unwrap();
          toast.success(`${entityName} updated successfully.`);
        } else if (formState.mode === 'create') {
          const payload = formDataToCreatePayload(formData);
          await createEntityTrigger(payload).unwrap();
          toast.success(`${entityName} created successfully.`);
        }
        handleCloseForm();
      } catch (error) {
        const action = formState.mode === 'edit' ? 'update' : 'create';
        const fallbackMessage = `Failed to ${action} ${entityName.toLowerCase()}.`;
        toast.error(getApiErrorMessage(error, fallbackMessage));
      } finally {
        submitInFlightRef.current = false
      }
    },
    [formState, entityName, handleCloseForm, createEntityTrigger, updateEntityTrigger, formDataToCreatePayload, formDataToUpdatePayload]
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingEntity || submitInFlightRef.current) return
    submitInFlightRef.current = true

    try {
      await deleteEntityTrigger(deletingEntity.id).unwrap()
      toast.success(`${entityName} "${deletingEntity.title || ''}" has been deleted.`)
      setDeletingEntity(null)
    } catch (error) {
      const fallbackMessage = `Failed to delete ${entityName.toLowerCase()}.`
      toast.error(getApiErrorMessage(error, fallbackMessage))
    } finally {
      submitInFlightRef.current = false
    }
  }, [deletingEntity, entityName, deleteEntityTrigger])

  return {
    formState,
    editingEntity: formState.mode === 'edit' ? formState.entity : null,
    deletingEntity,
    setDeletingEntity,
    isFormOpen: formState.mode !== 'idle',
    isMutating,
    handleOpenCreate,
    handleOpenEdit,
    handleCloseForm,
    handleSubmit,
    handleDeleteConfirm,
  }
}