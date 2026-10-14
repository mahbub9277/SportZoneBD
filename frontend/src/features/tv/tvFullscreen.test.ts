import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumeTVFullscreenActivationRequest,
  isFullscreenActive,
  requestTVFullscreen,
  requestTVFullscreenFromActivation,
  subscribeToFullscreenChange,
} from './tvFullscreen.ts'

function installFullscreenDocument(request: () => Promise<void>) {
  let activeElement: Element | null = null
  let requestCount = 0
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const root = {
    requestFullscreen: () => {
      requestCount += 1
      return request()
    },
  } as unknown as HTMLElement
  const fakeDocument = {
    documentElement: root,
    fullscreenEnabled: true,
    get fullscreenElement() {
      return activeElement
    },
    exitFullscreen: async () => {
      activeElement = null
    },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      const registrations = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
      registrations.add(listener)
      listeners.set(type, registrations)
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener)
    },
  } as unknown as Document
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })

  return {
    root,
    get requestCount() {
      return requestCount
    },
    setActiveElement(element: Element | null) {
      activeElement = element
    },
    emit(type: string) {
      const event = new Event(type)
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === 'function') listener(event)
        else listener.handleEvent(event)
      }
    },
    restore() {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
      else Reflect.deleteProperty(globalThis, 'document')
    },
  }
}

test('the TV entry click requests the whole document synchronously and the route reuses it', async () => {
  let resolveRequest!: () => void
  const browser = installFullscreenDocument(() => new Promise<void>((resolve) => { resolveRequest = resolve }))

  try {
    requestTVFullscreenFromActivation()
    assert.equal(browser.requestCount, 1)

    const activationRequest = consumeTVFullscreenActivationRequest()
    assert.ok(activationRequest)
    const mountedRequest = requestTVFullscreen(browser.root)
    assert.equal(browser.requestCount, 1)

    browser.setActiveElement(browser.root)
    resolveRequest()
    assert.equal(await activationRequest, true)
    assert.equal(await mountedRequest, true)
    assert.equal(isFullscreenActive(), true)
  } finally {
    browser.restore()
  }
})

test('a rejected native request is reported as blocked rather than fullscreen', async () => {
  const browser = installFullscreenDocument(() => Promise.reject(new Error('fullscreen denied')))

  try {
    requestTVFullscreenFromActivation()
    const request = consumeTVFullscreenActivationRequest()
    assert.ok(request)
    assert.equal(await request, false)
    assert.equal(isFullscreenActive(), false)
  } finally {
    browser.restore()
  }
})

test('fullscreen state and request errors are observed and listeners are removed', () => {
  const browser = installFullscreenDocument(() => Promise.resolve())
  let changeCount = 0
  let errorCount = 0

  try {
    const unsubscribe = subscribeToFullscreenChange(
      (active) => {
        assert.equal(active, true)
        changeCount += 1
      },
      () => {
        errorCount += 1
      },
    )

    browser.setActiveElement(browser.root)
    browser.emit('fullscreenchange')
    browser.emit('fullscreenerror')
    unsubscribe()
    browser.emit('fullscreenchange')
    browser.emit('fullscreenerror')

    assert.equal(changeCount, 1)
    assert.equal(errorCount, 1)
  } finally {
    browser.restore()
  }
})
