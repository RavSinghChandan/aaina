import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'landing-page',
  imports: [RouterLink],
  template: `
    <header class="topbar"><div class="wrap">
      <a class="brand" routerLink="/"><span class="brand-mark" aria-hidden="true">a</span><span>Aaina</span></a>
      <nav class="nav"><a routerLink="/t/demo">Demo</a><a routerLink="/start">Get started</a></nav>
    </div></header>

    <main>
      <section class="hero"><div class="wrap">
        <p class="eyebrow">The AI mirror for salons</p>
        <h1>Show every customer the look that truly suits them — before the first cut.</h1>
        <p class="lead">One photo, a few questions, and Aaina recommends the three best haircuts for their face, hair, work and taste — with previews, hair and face routines, and a reminder of when to come back.</p>
        <div class="row cta">
          <a class="btn btn-primary" routerLink="/t/demo/consult">Try a consultation</a>
          <a class="btn btn-ghost" routerLink="/start">Set up my salon</a>
        </div>
        <p class="muted small">For women's, men's and unisex salons and parlours. Works on any phone; shows on the salon TV too.</p>
      </div></section>

      <section class="wrap how">
        <h2>How it works in the chair</h2>
        <ol class="grid grid-3 steps">
          <li class="card flat"><span class="n">1</span><h3>Photo & a few questions</h3><p class="muted">Face photo with consent, plus work, lifestyle, likes and dislikes. Two minutes.</p></li>
          <li class="card flat"><span class="n">2</span><h3>Three looks, with reasons</h3><p class="muted">Aaina's agents read face shape and hair, then pick three cuts and explain why each suits them.</p></li>
          <li class="card flat"><span class="n">3</span><h3>Choose, cut, come back</h3><p class="muted">A hair and face routine to take home, and a care calendar that brings them back on time.</p></li>
        </ol>
      </section>

      <section class="wrap why">
        <div class="grid grid-2">
          <div class="card"><h3>For your customers</h3><ul class="list">
            <li>"Will this suit me?" — answered before the cut</li><li>Previews of each look on their face shape</li>
            <li>A simple routine for hair and skin</li><li>Their photo is never stored without permission</li></ul></div>
          <div class="card"><h3>For your salon</h3><ul class="list">
            <li>Confident consultations, fewer unhappy cuts</li><li>Natural upsell: spa, treatments, products</li>
            <li>A "who is due" list with one-tap WhatsApp reminders</li><li>Your salon's own link and colours</li></ul></div>
        </div>
      </section>

      <section class="wrap pricing">
        <div class="card price">
          <p class="eyebrow">Simple pricing</p>
          <div class="amount">₹500<span>/month per salon</span></div>
          <p class="muted">Up to 300 consultations a month. Start free with 50.</p>
          <a class="btn btn-brand" routerLink="/start">Start free</a>
        </div>
      </section>
    </main>
    <footer class="wrap foot muted small">Aaina gives grooming guidance, not medical advice. © {{ year }} Aaina</footer>
  `,
  styles: [`
    .hero { padding: 48px 0 32px; background: radial-gradient(900px 400px at 85% -10%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 70%); }
    .hero h1 { max-width: 18ch; }
    .lead { font-size: 1.1rem; color: var(--ink-2); max-width: 58ch; margin: 16px 0 24px; }
    .cta { margin-bottom: 12px; }
    .how, .why, .pricing { padding-top: 40px; }
    .steps { list-style: none; padding: 0; margin: 16px 0 0; }
    .steps .n { width: 36px; height: 36px; border-radius: 50%; background: var(--ink); color: #fff; display: grid; place-items: center; font-weight: 800; margin-bottom: 12px; }
    .price { text-align: center; max-width: 440px; margin: 0 auto; }
    .amount { font-family: var(--serif); font-size: 3rem; margin: 6px 0; }
    .amount span { font-family: var(--font); font-size: 1rem; color: var(--ink-3); margin-left: 6px; }
    .foot { padding: 48px 16px 32px; }
  `],
})
export class LandingPage { year = new Date().getFullYear(); }
