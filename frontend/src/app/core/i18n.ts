import { Injectable, computed, signal } from '@angular/core';

export interface LanguageInfo { code: string; native: string; english: string; speech: string; fallback: string | null; }
interface LanguageConfig { default: string; enabled: string[]; languages: LanguageInfo[]; }

const STORAGE_KEY = 'aaina.lang';

/**
 * Every word on screen comes from public/i18n/<code>.json; the list of
 * languages is public/i18n/languages.json, so adding or hiding a language is a
 * config change. A missing word walks the fallback chain to English.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  readonly available = signal<LanguageInfo[]>([]);
  readonly lang = signal<string>(stored() || 'en');
  readonly chosen = signal<boolean>(!!stored());
  private dicts = signal<Record<string, Record<string, string>>>({});

  readonly current = computed(() => this.available().find(l => l.code === this.lang()));

  /** Translate a key; {name} placeholders come from params; `fallback` is shown when no language has the key. */
  readonly t = computed(() => {
    const code = this.lang(), dicts = this.dicts(), byCode = new Map(this.available().map(l => [l.code, l]));
    return (key: string, params?: Record<string, string | number> | null, fallback?: string): string => {
      let out: string | undefined;
      const seen = new Set<string>();
      for (let at: string | null | undefined = code; at && !seen.has(at); at = byCode.get(at)?.fallback ?? (at === 'en' ? null : 'en')) {
        out = dicts[at]?.[key];
        if (out) break;
        seen.add(at);
      }
      out = out ?? dicts['en']?.[key] ?? fallback ?? key;
      return params ? out.replace(/\{(\w+)\}/g, (_, p) => String(params[p] ?? '')) : out;
    };
  });

  async init(): Promise<void> {
    try {
      const cfg: LanguageConfig = await (await fetch('i18n/languages.json')).json();
      this.available.set(cfg.languages.filter(l => cfg.enabled.includes(l.code)));
      const fromLink = new URLSearchParams(location.hash.slice(1)).get('l') || new URLSearchParams(location.search).get('lang');
      if (fromLink && cfg.enabled.includes(fromLink)) this.remember(fromLink);
      const want = [fromLink, stored(), cfg.default].find(c => c && cfg.enabled.includes(c)) || 'en';
      await this.use(want);
    } catch { /* offline first load: English keys still render via fallbacks */ }
  }

  async set(code: string) { this.remember(code); await this.use(code); }

  private remember(code: string) {
    this.chosen.set(true);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* private mode */ }
  }

  private async use(code: string) {
    const chain: string[] = [];
    for (let at: string | null | undefined = code; at && !chain.includes(at); at = this.available().find(l => l.code === at)?.fallback ?? (at === 'en' ? null : 'en')) chain.push(at);
    if (!chain.includes('en')) chain.push('en');
    const loaded = { ...this.dicts() };
    await Promise.all(chain.filter(c => !loaded[c]).map(async c => {
      try { loaded[c] = await (await fetch(`i18n/${c}.json`)).json(); } catch { loaded[c] = {}; }
    }));
    this.dicts.set(loaded);
    this.lang.set(code);
    document.documentElement.lang = code;
  }
}

function stored(): string | null { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } }
