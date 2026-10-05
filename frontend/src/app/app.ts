import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { API_BASE } from './core/config';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App implements OnInit {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  /** The free API host sleeps when idle; wake it the moment someone arrives, so it is ready by the last step. */
  ngOnInit() {
    if (this.browser) fetch(`${API_BASE}/api/health`, { cache: 'no-store' }).catch(() => {});
  }
}
