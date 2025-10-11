import '@testing-library/jest-dom'

// Create a persistent store for localStorage
let store = {}

// Set up localStorage mock once with proper jest mock functions
const localStorageMock = {
  getItem: jest.fn().mockImplementation((key) => store[key] || null),
  setItem: jest.fn().mockImplementation((key, value) => { store[key] = value.toString() }),
  removeItem: jest.fn().mockImplementation((key) => { delete store[key] }),
  clear: jest.fn().mockImplementation(() => { store = {} }),
}

global.localStorage = localStorageMock

// Mock fetch
global.fetch = jest.fn()

// Reset state and clear mock calls before each test
beforeEach(() => {
  store = {}
  localStorageMock.getItem.mockClear().mockImplementation((key) => store[key] || null)
  localStorageMock.setItem.mockClear().mockImplementation((key, value) => { store[key] = value.toString() })
  localStorageMock.removeItem.mockClear().mockImplementation((key) => { delete store[key] })
  localStorageMock.clear.mockClear().mockImplementation(() => { store = {} })
  if (global.fetch && typeof global.fetch.mockClear === 'function') {
    global.fetch.mockClear()
  }
})

