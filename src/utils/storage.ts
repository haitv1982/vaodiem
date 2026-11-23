import { GradebookClass } from '../types/gradebook';

const DB_NAME = 'vnedu_camera_gradebook_db';
const DB_VERSION = 1;
const STORE_NAME = 'gradebooks';
const ACTIVE_CLASS_KEY = 'vnedu_active_class_id';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadAllGradebooks(): Promise<GradebookClass[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result as GradebookClass[]) ?? [];
        items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to load gradebooks from IndexedDB:', err);
    return [];
  }
}

export async function saveGradebook(gradebook: GradebookClass): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(gradebook);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteGradebook(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getStoredActiveClassId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CLASS_KEY);
  } catch {
    return null;
  }
}

export function setStoredActiveClassId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_CLASS_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_CLASS_KEY);
    }
  } catch {
    // ignore storage errors
  }
}
