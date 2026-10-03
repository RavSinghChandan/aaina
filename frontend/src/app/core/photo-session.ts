import { Injectable, signal } from '@angular/core';

const KEY = 'aaina.photo';

/**
 * The customer's photo for this browser tab only (sessionStorage is cleared when the
 * tab closes), shown as "You today" beside the previews. The server never keeps it.
 */
@Injectable({ providedIn: 'root' })
export class PhotoSession {
  readonly photo = signal<string | null>(read());

  set(photo: string | null) {
    this.photo.set(photo);
    try { photo ? sessionStorage.setItem(KEY, photo) : sessionStorage.removeItem(KEY); } catch { /* private mode: memory only */ }
  }
}

function read(): string | null { try { return sessionStorage.getItem(KEY); } catch { return null; } }
