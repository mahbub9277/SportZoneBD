import React from 'react'

if (process.env.NODE_ENV !== 'production') {
  type ElementConfig = { key?: React.Key | null; [key: string]: unknown }
  type ReactRuntime = {
    createElement: (type: React.ElementType, config?: ElementConfig | null, ...children: React.ReactNode[]) => React.ReactElement
  }
  const reactRuntime = React as unknown as ReactRuntime
  const origCreateElement = reactRuntime.createElement
  let __auto_key_counter = 0

  // Monkey-patch React.createElement to replace explicit empty-string keys
  // with generated unique keys. This avoids the runtime warning about
  // duplicate empty-string keys while preserving behavior in production.
  reactRuntime.createElement = function patchedCreateElement(type, config, ...children) {
    if (config && Object.prototype.hasOwnProperty.call(config, 'key') && config.key === '') {
      const newConfig = { ...config, key: `__auto_key_${__auto_key_counter++}` }
      return origCreateElement(type, newConfig, ...children)
    }
    return origCreateElement(type, config, ...children)
  }
}

export {}
