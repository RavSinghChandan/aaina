import { Injectable, inject, signal } from '@angular/core';
import { I18n } from './i18n';

/** Reads the screen aloud in the chosen language with the phone's own voices. Nothing is sent anywhere. */
@Injectable({ providedIn: 'root' })
export class Speech {
  private i18n = inject(I18n);
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  readonly speaking = signal(false);

  readElement(el: Element | null) {
    if (!el) return;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-noread], svg, input, select, script, style').forEach(n => n.remove());
    this.say((clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim());
  }

  say(text: string) {
    if (!this.supported || !text) return;
    speechSynthesis.cancel();
    const locale = this.i18n.current()?.speech || 'en-IN';
    const u = new SpeechSynthesisUtterance(text.slice(0, 1500));
    u.lang = locale;
    u.rate = 0.92;
    const voices = speechSynthesis.getVoices();
    const v = voices.find(x => x.lang.replace('_', '-').toLowerCase() === locale.toLowerCase()) ?? voices.find(x => x.lang.toLowerCase().startsWith(locale.slice(0, 2)));
    if (v) u.voice = v;
    u.onend = u.onerror = () => this.speaking.set(false);
    this.speaking.set(true);
    speechSynthesis.speak(u);
  }

  stop() { if (this.supported) speechSynthesis.cancel(); this.speaking.set(false); }
}
