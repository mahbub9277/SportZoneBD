import { useState } from 'react'
import { Sparkles, Loader2, Languages } from 'lucide-react'
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
  language?: 'auto' | 'en' | 'bn' | 'banglish'
  tone?: 'professional' | 'concise' | 'friendly'
}

export function DescriptionGenerator({ entityType, title, subtitle, context, currentDescription, onGenerated, disabled = false, language = 'auto', tone = 'professional' }: DescriptionGeneratorProps) {
  const [generateDescription, { isLoading }] = useGenerateDescriptionMutation()
  const [selectedLanguage, setSelectedLanguage] = useState(language)
  const hasContext = Object.values(context ?? {}).some((value) => value !== null && value !== undefined && String(value).trim() !== '')
  const handleGenerate = async () => {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      toast.error('Add a title before generating a description.')
      return
    }
    if (currentDescription?.trim() && !window.confirm('Replace the existing description with a generated version?')) return
    try {
      const result = await generateDescription({ entityType, title: normalizedTitle, subtitle: subtitle?.trim(), context, language: selectedLanguage, tone }).unwrap()
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
    <div className="flex flex-wrap items-center gap-2">
      <span className="hidden text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted sm:inline">{hasContext ? 'Context ready' : 'AI assist'}</span>
      <label className="sr-only" htmlFor={`ai-language-${entityType}`}>AI output language</label>
      <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-surface-soft/60 px-2">
        <Languages className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
        <select id={`ai-language-${entityType}`} value={selectedLanguage} onChange={(event) => setSelectedLanguage(event.target.value as typeof selectedLanguage)} disabled={disabled || isLoading} className="h-8 bg-transparent text-xs text-text-primary outline-none">
          <option value="auto">Auto language</option>
          <option value="en">English</option>
          <option value="bn">Bangla</option>
          <option value="banglish">Banglish</option>
        </select>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => void handleGenerate()} disabled={disabled || isLoading} aria-label={isLoading ? 'Generating description' : 'Generate description with AI'} title="Generate description with AI" className="gap-2 border-accent/30 hover:border-accent/60 hover:bg-accent/5">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {isLoading ? 'Drafting...' : 'Generate with AI'}
      </Button>
    </div>
  )
}
