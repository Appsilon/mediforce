// Firebase mock stubs for unit tests
// Usage: vi.mock('@/lib/firebase', () => firebaseMocks)
export const firebaseMocks = {
  auth: { currentUser: null, onAuthStateChanged: vi.fn() },
  db: {},
};

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  onSnapshot: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));
