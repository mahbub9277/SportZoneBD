import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { type VariantProps } from 'class-variance-authority'

import { Spinner } from './Spinner'
import { cn } from '../../lib/utils'
import { buttonVariants } from './button.variants'


export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  isLoading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, isLoading = false, children, ...props }, ref) => {
    const childrenArray = React.Children.toArray(children)
    const firstChild = childrenArray.length === 1 ? childrenArray[0] : null
    const isFragment = firstChild && (firstChild as any).type === React.Fragment
    const useSlot = asChild && firstChild && React.isValidElement(firstChild) && !isFragment
    const Comp: any = useSlot ? Slot : 'button'

    if (asChild && !useSlot) {
      // Warn in dev when asChild is misused so it's easier to find the culprit
      // and fall back to rendering a normal button to avoid the runtime Slot error.
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(
          'Button: `asChild` was set but child is not a single valid React element. Falling back to a native `button` to avoid Slot runtime errors.',
        )
      }
    }

    return (
      <Comp
        // Disable the button when loading
        disabled={isLoading || props.disabled}
        // Add a loading class for potential styling adjustments
        data-loading={isLoading ? 'true' : 'false'}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {useSlot ? (
          React.isValidElement(children) ? (
            React.cloneElement(children, undefined,
              <>{isLoading && <Spinner size="1em" className="mr-2" />} {(children as React.ReactElement<any>).props.children}</>
            )
          ) : null
        ) : (
          <>{isLoading && <Spinner size="1em" className="mr-2" />} {children}</>
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button }