import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '../../lib/utils';
import { usePerformanceProfile } from '../../hooks/usePerformanceProfile';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, asChild = false, children, ...props }, ref) => {
    const childrenArray = React.Children.toArray(children)
    const firstChild = childrenArray.length === 1 ? childrenArray[0] : null
    const isFragment = React.isValidElement(firstChild) && firstChild.type === React.Fragment
    const useSlot = asChild && firstChild && React.isValidElement(firstChild) && !isFragment
    const { deviceTier, isSmartTV, reducedMotion, shouldReduceEffects, supportsBackdropFilter } = usePerformanceProfile()
    const simplifyCard = deviceTier === 'low' || isSmartTV || shouldReduceEffects || reducedMotion

    if (asChild && !useSlot) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          'Card: `asChild` was set but child is not a single valid React element. Falling back to a native `div` to avoid Slot runtime errors.',
        )
      }
    }

    const Comp: React.ElementType = useSlot ? Slot : 'div'
    return (
      <Comp
        ref={ref}
        className={cn(
          'group relative overflow-hidden rounded-3xl border border-(--border)/20 bg-(--surface)/80 text-(--text-primary) transition-all duration-300 focus-within:ring-2 focus-within:ring-(--accent)/30 focus-within:ring-offset-(--surface)',
          supportsBackdropFilter && !simplifyCard ? 'backdrop-blur-lg' : 'backdrop-blur-none bg-(--surface)/95',
          simplifyCard ? 'shadow-[0_10px_28px_rgba(2,6,23,0.10)] hover:border-(--accent)/20 hover:shadow-[0_12px_34px_rgba(2,6,23,0.12)]' : 'shadow-soft hover:border-(--accent)/30 hover:shadow-glow',
          className,
        )}
        {...props}
      >
        {useSlot ? firstChild : children}
      </Comp>
    )
  },
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-2 p-6', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-xl font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-brand-text-muted', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardImage = React.forwardRef<
  HTMLImageElement,
  React.ImgHTMLAttributes<HTMLImageElement>
>(({ className, ...props }, ref) => (
  <img
    ref={ref}
    className={cn('w-full object-cover', className)}
    {...props}
  />
));
CardImage.displayName = 'CardImage';

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';


export { Card, CardHeader, CardTitle, CardDescription, CardImage, CardContent, CardFooter };