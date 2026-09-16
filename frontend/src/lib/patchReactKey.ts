import React from 'react'

if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactAny: any = React
  const origCreateElement = reactAny.createElement
  let __auto_key_counter = 0

  // Monkey-patch React.createElement to replace explicit empty-string keys
  // with generated unique keys. This avoids the runtime warning about
  // duplicate empty-string keys while preserving behavior in production.
  reactAny.createElement = function patchedCreateElement(type: any, config: any, ...children: any[]) {
    if (config && Object.prototype.hasOwnProperty.call(config, 'key') && config.key === '') {
      const newConfig = { ...config, key: `__auto_key_${__auto_key_counter++}` }
      return origCreateElement.apply(this, [type, newConfig, ...children])
    }
    return origCreateElement.apply(this, [type, config, ...children])
  }
}

export {}
