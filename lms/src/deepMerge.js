function isMergeable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

export function deepMerge(target, ...sources) {
  for (const source of sources) {
    if (!isMergeable(source)) {
      continue
    }
    for (const key of Object.keys(source)) {
      if (key === '__proto__') {
        continue
      }
      const value = source[key]
      if (isMergeable(value)) {
        if (!isMergeable(target[key])) {
          target[key] = {}
        }
        deepMerge(target[key], value)
      } else {
        target[key] = value
      }
    }
  }
  return target
}

export function mergePreferences(defaults, incoming) {
  return deepMerge({}, defaults, incoming)
}
