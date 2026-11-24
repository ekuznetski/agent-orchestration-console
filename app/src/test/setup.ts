import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount everything Testing Library rendered, after every test.
afterEach(cleanup)
