import { Component, ElementRef, OnDestroy, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../core/api.service';
import { fileToDataUrl, videoFrameToDataUrl } from '../core/image';
import { FormSection, IntakeForm, StepState } from '../core/models';
import { SalonStore } from '../core/salon.store';
import { QuestionField } from '../shared/question-field';
import { SalonBar } from '../shared/salon-bar';

type Stage = 'consent' | 'photo' | 'questions' | 'thinking';

@Component({
  selector: 'consult-page',
  imports: [FormsModule, SalonBar, QuestionField],
  template: `
    <salon-bar [slug]="slug()" [name]="store.salon()?.name" />
    <main class="wrap narrow page">
      <div class="progress" aria-hidden="true"><span [style.width.%]="progressPct()"></span></div>

      @switch (stage()) {
        @case ('consent') {
          <section class="stack">
            <p class="eyebrow">Before we start</p>
            <h2>Your photo, your choice</h2>
            <div class="card flat stack">
              <p>We use one photo of your face to read face shape and hair, so we can suggest styles that suit you.</p>
              <ul class="list small">
                <li>✓ Used only for this consultation</li>
                <li>✓ {{ store.salon()?.settings?.store_photos ? 'Not saved unless you allow it below' : 'Not saved — it is discarded after analysis' }}</li>
                <li>✓ We never collect genetic or health data</li>
                <li>✓ You can ask the salon to delete your details any time</li>
              </ul>
            </div>
            <label class="check"><input type="checkbox" [(ngModel)]="consentPhoto" /> <span>I agree to my photo being analysed for this consultation.</span></label>
            @if (store.salon()?.settings?.store_photos) {
              <label class="check"><input type="checkbox" [(ngModel)]="consentStore" /> <span>Save my photo with my profile so the salon can compare next time.</span></label>
            }
            <div class="grid grid-2">
              <label class="field"><span class="label">Name <span class="muted small">(optional)</span></span><input class="input" [(ngModel)]="customerName" autocomplete="given-name" /></label>
              <label class="field"><span class="label">Mobile <span class="muted small">(for reminders)</span></span><input class="input" [(ngModel)]="phone" inputmode="tel" autocomplete="tel" placeholder="10-digit number" /></label>
            </div>
          </section>
        }
        @case ('photo') {
          <section class="stack">
            <p class="eyebrow">Step 1</p>
            <h2>Take a front-facing photo</h2>
            <p class="muted">Good light, face straight to the camera, hair as it usually is.</p>
            <div class="camera">
              @if (photo()) { <img [src]="photo()" alt="Your photo" /> }
              @else if (camOn()) { <video #video autoplay playsinline muted></video><div class="guide" aria-hidden="true"></div> }
              @else { <div class="placeholder"><span>📷</span><p class="muted small">{{ camError() || 'Camera preview appears here' }}</p></div> }
            </div>
            <div class="row">
              @if (photo()) { <button type="button" class="btn btn-ghost" (click)="retake()">Retake</button> }
              @else if (camOn()) { <button type="button" class="btn btn-primary" (click)="capture()">Capture</button> }
              @else { <button type="button" class="btn btn-primary" (click)="startCamera()">Open camera</button> }
              <label class="btn btn-ghost">Upload photo<input type="file" accept="image/*" capture="user" class="sr-only" (change)="upload($event)" /></label>
            </div>
            <details class="card flat">
              <summary><strong>Add styles you like or your social photos</strong> <span class="muted small">(optional, up to 4)</span></summary>
              <p class="muted small">Upload pictures you choose — we never look at your social accounts.</p>
              <label class="btn btn-ghost btn-sm">Add photos<input type="file" accept="image/*" multiple class="sr-only" (change)="uploadExtra($event)" /></label>
              <div class="thumbs">@for (x of extras(); track $index) { <img [src]="x" alt="Extra photo {{ $index + 1 }}" /> }</div>
            </details>
          </section>
        }
        @case ('questions') {
          @if (section(); as sec) {
            <section class="stack">
              <p class="eyebrow">Step {{ sectionIdx() + 2 }} of {{ (form()?.sections?.length ?? 0) + 1 }}</p>
              <h2>{{ sec.title }}</h2>
              @for (f of sec.fields; track f.id) {
                <question-field [field]="f" [value]="answers()[f.id]" (valueChange)="setAnswer(f.id, $event)" />
              }
            </section>
          }
        }
        @case ('thinking') {
          <section class="stack center think">
            <div class="orb" aria-hidden="true"></div>
            <h2>{{ thinkTitle() }}</h2>
            <ul class="agents">
              @for (s of agentSteps(); track s.id) {
                <li [class]="s.state.status">
                  <span class="ic" aria-hidden="true">{{ s.state.status === 'done' ? '✓' : s.state.status === 'failed' ? '!' : s.state.status === 'running' ? '' : '·' }}</span>
                  <span>{{ s.title }}</span>
                  <span class="muted small">{{ s.state.status === 'running' ? 'working…' : s.state.status === 'done' ? (s.state.ms ?? 0) / 1000 + 's' : '' }}</span>
                </li>
              }
            </ul>
            @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
          </section>
        }
      }
      @if (error() && stage() !== 'thinking') { <p class="err" role="alert">{{ error() }}</p> }
    </main>

    @if (stage() !== 'thinking') {
      <div class="actionbar"><div class="wrap narrow">
        @if (stage() !== 'consent') { <button type="button" class="btn btn-ghost" (click)="back()">Back</button> }
        <button type="button" class="btn btn-primary" [disabled]="!canNext()" (click)="next()">{{ nextLabel() }}</button>
      </div></div>
    }
  `,
  styles: [`
    .progress { height: 4px; background: var(--line); border-radius: 4px; overflow: hidden; margin-bottom: 20px; }
    .progress span { display: block; height: 100%; background: var(--brand); transition: width .3s; }
    .check { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border: 1.5px solid var(--line); border-radius: var(--radius-sm); background: #fff; cursor: pointer; }
    .check input { width: 22px; height: 22px; margin-top: 2px; accent-color: var(--brand); flex: none; }
    .camera { position: relative; aspect-ratio: 3 / 4; max-height: 62vh; width: 100%; border-radius: var(--radius); overflow: hidden; background: #1c1916; display: grid; place-items: center; }
    .camera video, .camera img { width: 100%; height: 100%; object-fit: cover; }
    .camera video { transform: scaleX(-1); }
    .guide { position: absolute; inset: 14% 22% 24%; border: 2px dashed rgba(255,255,255,.7); border-radius: 50% / 45%; }
    .placeholder { text-align: center; color: #fff; } .placeholder span { font-size: 40px; }
    .thumbs { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; } .thumbs img { width: 64px; height: 64px; object-fit: cover; border-radius: 10px; }
    details summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .err { color: var(--danger); font-weight: 600; margin-top: 12px; }
    .think { padding-top: 24px; }
    .orb { width: 96px; height: 96px; margin: 0 auto 8px; border-radius: 50%; background: conic-gradient(var(--brand), var(--brand-2), var(--brand)); animation: spin 2.4s linear infinite; mask: radial-gradient(circle, transparent 52%, #000 54%); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .agents { list-style: none; padding: 0; margin: 12px auto 0; max-width: 420px; text-align: left; }
    .agents li { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); color: var(--ink-3); }
    .agents li.running, .agents li.done { color: var(--ink); }
    .ic { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--soft); font-weight: 800; font-size: .8rem; }
    .done .ic { background: var(--brand); color: #fff; }
    .failed .ic { background: var(--warn); color: #fff; }
    .running .ic { border: 2px solid var(--brand); border-right-color: transparent; background: none; animation: spin .8s linear infinite; }
  `],
})
export class ConsultPage implements OnInit, OnDestroy {
  slug = input.required<string>();
  store = inject(SalonStore);
  private api = inject(Api);
  private router = inject(Router);
  private video = viewChild<ElementRef<HTMLVideoElement>>('video');

  stage = signal<Stage>('consent');
  form = signal<IntakeForm | null>(null);
  workflowSteps = signal<{ id: string; title: string }[]>([]);
  sectionIdx = signal(0);
  answers = signal<Record<string, any>>({});
  photo = signal<string | null>(null);
  extras = signal<string[]>([]);
  camOn = signal(false);
  camError = signal<string | null>(null);
  error = signal<string | null>(null);
  steps = signal<Record<string, StepState>>({});
  consentPhoto = false; consentStore = false; customerName = ''; phone = '';
  private stream?: MediaStream;
  private pollTimer?: ReturnType<typeof setTimeout>;

  section = computed<FormSection | null>(() => this.form()?.sections[this.sectionIdx()] ?? null);
  progressPct = computed(() => {
    const total = (this.form()?.sections.length ?? 4) + 2;
    const pos = this.stage() === 'consent' ? 0 : this.stage() === 'photo' ? 1 : this.stage() === 'questions' ? 2 + this.sectionIdx() : total;
    return Math.round((pos / total) * 100);
  });
  agentSteps = computed(() => this.workflowSteps().map(s => ({ ...s, state: this.steps()[s.id] ?? { status: 'pending' as const } })));
  thinkTitle = computed(() => {
    const running = this.agentSteps().find(s => s.state.status === 'running');
    return running ? `${running.title}…` : 'Preparing your looks…';
  });
  nextLabel = computed(() => {
    if (this.stage() === 'photo') return this.photo() ? 'Use this photo' : 'Continue without photo';
    if (this.stage() === 'questions' && this.sectionIdx() === (this.form()?.sections.length ?? 1) - 1) return 'Show my looks';
    return 'Continue';
  });

  async ngOnInit() {
    await this.store.load(this.slug());
    const meta = await this.api.meta();
    this.form.set(meta.forms['intake'] ?? null);
    this.workflowSteps.set(meta.workflows['consultation']?.steps.map(s => ({ id: s.id, title: s.title })) ?? []);
  }

  ngOnDestroy() { this.stopCamera(); clearTimeout(this.pollTimer); }

  setAnswer(id: string, v: any) { this.answers.update(a => ({ ...a, [id]: v })); }

  canNext(): boolean {
    if (this.stage() === 'consent') return true;
    if (this.stage() === 'photo') return !this.photo() || this.consentPhoto;
    const sec = this.section();
    return !!sec && sec.fields.every(f => f.optional || this.filled(this.answers()[f.id]));
  }
  private filled(v: any) { return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''; }

  next() {
    this.error.set(null);
    if (this.stage() === 'consent') { this.stage.set('photo'); return; }
    if (this.stage() === 'photo') {
      if (this.photo() && !this.consentPhoto) { this.error.set('Please agree to photo analysis, or continue without a photo.'); return; }
      this.stopCamera(); this.stage.set('questions'); this.sectionIdx.set(0); return;
    }
    if (this.stage() === 'questions') {
      const last = (this.form()?.sections.length ?? 1) - 1;
      if (this.sectionIdx() < last) { this.sectionIdx.update(i => i + 1); scrollTo({ top: 0 }); }
      else this.submit();
    }
  }

  back() {
    this.error.set(null);
    if (this.stage() === 'questions' && this.sectionIdx() > 0) this.sectionIdx.update(i => i - 1);
    else if (this.stage() === 'questions') this.stage.set('photo');
    else if (this.stage() === 'photo') { this.stopCamera(); this.stage.set('consent'); }
  }

  async startCamera() {
    this.camError.set(null);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
      this.camOn.set(true);
      queueMicrotask(() => { const v = this.video()?.nativeElement; if (v) v.srcObject = this.stream!; });
    } catch {
      this.camError.set('Camera not available — use Upload photo instead.');
    }
  }
  capture() {
    const v = this.video()?.nativeElement;
    if (!v?.videoWidth) return;
    this.photo.set(videoFrameToDataUrl(v));
    this.stopCamera();
  }
  retake() { this.photo.set(null); this.startCamera(); }
  stopCamera() { this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined; this.camOn.set(false); }

  async upload(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.stopCamera();
    this.photo.set(await fileToDataUrl(file));
  }
  async uploadExtra(ev: Event) {
    const files = Array.from((ev.target as HTMLInputElement).files ?? []).slice(0, 4 - this.extras().length);
    const urls = await Promise.all(files.map(f => fileToDataUrl(f, 768)));
    this.extras.update(x => [...x, ...urls].slice(0, 4));
  }

  async submit() {
    this.stage.set('thinking');
    try {
      const res = await this.api.startConsultation(this.slug(), {
        customer: { name: this.customerName || null, phone: this.phone || null },
        consent: { photo_processing: this.consentPhoto, store_photo: this.consentStore },
        answers: { ...this.answers(), name: this.customerName || this.answers()['name'] },
        photo: this.consentPhoto ? this.photo() : null,
        extra_photos: this.consentPhoto ? this.extras() : [],
      });
      this.poll(res.id);
    } catch (e: any) {
      this.error.set(e?.error?.detail ?? 'Could not start the consultation. Please try again.');
      this.stage.set('questions');
    }
  }

  private poll(id: string) {
    this.api.consultation(this.slug(), id).then(c => {
      this.steps.set(c.steps);
      if (c.status === 'done') { this.router.navigate(['/t', this.slug(), 'c', id]); return; }
      if (c.status === 'failed') { this.error.set('Something went wrong while preparing your looks. Please try again.'); return; }
      this.pollTimer = setTimeout(() => this.poll(id), 800);
    }).catch(() => { this.pollTimer = setTimeout(() => this.poll(id), 1500); });
  }
}
