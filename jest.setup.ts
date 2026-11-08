import '@testing-library/jest-dom'

// In-memory localStorage backing store, reset before every test.
let store: Record<string, string> = {}

const impl = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = String(value)
  },
  removeItem: (key: string) => {
    delete store[key]
  },
  clear: () => {
    store = {}
  },
}

const localStorageMock = {
  getItem: jest.fn(impl.getItem),
  setItem: jest.fn(impl.setItem),
  removeItem: jest.fn(impl.removeItem),
  clear: jest.fn(impl.clear),
}

Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })

global.fetch = jest.fn() as jest.Mock

// Tests call jest.restoreAllMocks(), which can strip implementations, so
// re-apply them (and clear recorded calls) before every test.
beforeEach(() => {
  store = {}
  localStorageMock.getItem.mockClear().mockImplementation(impl.getItem)
  localStorageMock.setItem.mockClear().mockImplementation(impl.setItem)
  localStorageMock.removeItem.mockClear().mockImplementation(impl.removeItem)
  localStorageMock.clear.mockClear().mockImplementation(impl.clear)
  const fetchMock: unknown = global.fetch
  if (jest.isMockFunction(fetchMock)) {
    fetchMock.mockClear()
  }
})

// jsdom doesn't implement <dialog>'s modal methods.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}
