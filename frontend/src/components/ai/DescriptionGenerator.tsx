import { Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/Button'
import { useGenerateDescriptionMutation, type AiEntityType } from '../../features/ai/ai.api'

interface DescriptionGeneratorProps {
  entityType: AiEntityType
  title: string
  subtitle?: string
  context?: Record<string, unknown>
  currentDescription?: string
  onGenerated: (description: string) => void
  disabled?: boolean
}

export function DescriptionGenerator({ entityType, title, subtitle, context, currentDescription, onGenerated, disabled = false }: DescriptionGeneratorProps) {
  const [generateDescription, { isLoading }] = useGenerateDescriptionMutation()
  const handleGenerate = async () => {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      toast.error('Add a title before generating a description.')
      return
    }
    if (currentDescription?.trim() && !window.confirm('Replace the existing description with a generated version?')) return
    try {
      const result = await generateDescription({ entityType, title: normalizedTitle, subtitle: subtitle?.trim(), context }).unwrap()
      const description = result.description.trim()
      if (!description) {
        toast.error('AI returned an empty description. Please try again.')
        return
      }
      onGenerated(description)
      toast.success('Description generated. Review it before saving.')
    } catch {
      toast.error('AI description generation failed. Please try again.')
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void handleGenerate()} disabled={disabled || isLoading} aria-label={isLoading ? 'Generating description' : 'Generate description with AI'} title="Generate description with AI" className="gap-2">
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {isLoading ? 'Generating...' : 'Generate with AI'}
    </Button>
  )
}
