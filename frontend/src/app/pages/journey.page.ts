import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { Router } from '@angular/router';
import { Api } from '../core/api.service';
import { FaceMeasure, measureFace, warmUp } from '../core/face-measure';
import { fileToDataUrl, videoFrameToDataUrl } from '../core/image';
import { PhotoSession } from '../core/photo-session';
import { journeySteps } from '../core/journey';
import { FormSection, IntakeForm, StepState } from '../core/models';
import { Chakra } from '../shared/chakra';
import { QuestionField } from '../shared/question-field';
import { TopBar } from '../shared/top-bar';
import { I18n } from '../core/i18n';


@Component({
  selector: 'journey-page',
  imports: [FormsModule, TitleCasePipe, QuestionField, Chakra, TopBar],
  template: `
    <top-bar [hideTabs]="true" />
    <main class="wrap page layout" [class.revealing]="isReveal()">
      <!-- the wheel: compact header on phones, a sticky side panel on big screens -->
      <aside class="side" data-noread>
        <div class="mini">
          <chakra class="wheel" [steps]="steps()" [current]="idx()" [spinning]="running()" [finished]="finished()"
                  [beads]="isReveal() ? beads() : []" [hubText]="hub()" (pick)="go($event)" />
          <div class="where">
            <p class="eyebrow">{{ t()('journey.stepOf', { n: idx() + 1, total: steps().length }) }}</p>
            <h2 class="title">{{ step()?.label }}</h2>
            @if (steps()[idx() + 1]; as n) { <p class="muted small">{{ t()('journey.next', { step: n.label }) }}</p> }
          </div>
        </div>
        <ol class="steplist" [attr.aria-label]="t()('journey.allSteps')">
          @for (s of steps(); track s.id; let i = $index) {
            <li [class.done]="i < idx() || finished()" [class.now]="i === idx() && !finished()">
              <button type="button" [disabled]="i >= idx() || running()" (click)="go(i)">
                <span class="n">{{ i < idx() || finished() ? '✓' : i + 1 }}</span><span>{{ s.label }}</span>
              </button>
            </li>
          }
        </ol>
      </aside>

      <section class="content">
        @switch (step()?.id) {
          @case ('hello') {
            <div class="stack">
              <h1 class="hello">{{ t()('journey.helloTitle') }}</h1>
              <ul class="how">
                <li><span>📷</span><div><strong>{{ t()('how.photo') }}</strong><p class="muted small">{{ t()('how.photoHint') }}</p></div></li>
                <li><span>👆</span><div><strong>{{ t()('how.taps') }}</strong><p class="muted small">{{ t()('how.tapsHint') }}</p></div></li>
                <li><span>✨</span><div><strong>{{ t()('how.looks') }}</strong><p class="muted small">{{ t()('how.looksHint') }}</p></div></li>
              </ul>
              <label class="check">
                <input type="checkbox" [(ngModel)]="consent" />
                <span><strong>{{ t()('journey.consent') }}</strong><br />
                  <span class="muted small">{{ t()(tryOn() ? 'journey.consentTryOn' : 'journey.consentHint') }}</span>
                </span>
              </label>
            </div>
          }
          @case ('photo') {
            <div class="stack">
              @if (!consent) {
                <div class="card flat stack">
                  <p><strong>{{ t()('journey.noPhoto') }}</strong></p>
                  <label class="check"><input type="checkbox" [(ngModel)]="consent" /> <span>{{ t()('journey.usePhotoAfterAll') }}</span></label>
                </div>
              } @else {
                <p class="muted">{{ t()('journey.photoTip') }}</p>
                @if (photo(); as src) {
                  <figure class="measured" [style.aspect-ratio]="ratio()" [style.max-width]="maxW()" data-noread>
                    <img [src]="src" alt="" (load)="onImg($event)" />
                    @if (measure(); as m) {
                      <svg [attr.viewBox]="'0 0 ' + m.width + ' ' + m.height" preserveAspectRatio="none" aria-hidden="true">
                        @for (l of m.lines; track l.id) {
                          <line [class]="'ml ' + l.id" [attr.x1]="l.a.x" [attr.y1]="l.a.y" [attr.x2]="l.b.x" [attr.y2]="l.b.y" [attr.stroke-width]="m.width / 160" />
                          <circle [attr.cx]="l.a.x" [attr.cy]="l.a.y" [attr.r]="m.width / 110" class="dot" />
                          <circle [attr.cx]="l.b.x" [attr.cy]="l.b.y" [attr.r]="m.width / 110" class="dot" />
                        }
                      </svg>
                    }
                    @if (measuring()) { <div class="scan" aria-hidden="true"></div> }
                  </figure>
                  @if (measuring()) { <p class="center muted" role="status">{{ t()('journey.measuring') }}</p> }
                  @if (measure(); as m) {
                    <div class="result card flat" role="status">
                      <div class="spread">
                        <div><p class="eyebrow">{{ t()('journey.measuredOnPhone') }}</p><h3 class="shape">{{ t()('journey.faceShape', { shape: shapeLabel(m.face_shape) }) }}</h3></div>
                        <span class="pill brand">{{ t()('journey.sure', { n: (m.confidence * 100).toFixed(0) }) }}</span>
                      </div>
                      @if (m.hair || m.beard) {
                        <div class="chips found">
                          @if (m.hair) { <span class="pill"><i class="sw" [style.background]="'rgb(' + m.hair.rgb.join(',') + ')'"></i>{{ t()('form.hair_length_now.' + m.hair.length, null, m.hair.length) }}</span> }
                          @if (m.beard) { <span class="pill">{{ t()('journey.beard') }}</span> }
                        </div>
                      }
                      @if (m.quality !== 'good') { <p class="muted small">{{ t()('journey.betterLight') }}</p> }
                    </div>
                  }
                  @if (measureError()) { <p class="err" role="alert">{{ t()('journey.measureFail') }}</p> }
                } @else {
                  <div class="camera" data-noread>
                    @if (camOn()) { <video #video autoplay playsinline muted></video><div class="guide" aria-hidden="true"></div> }
                    @else { <div class="placeholder"><span aria-hidden="true">📷</span><p class="small">{{ camError() ? t()('journey.noCamera') : t()('journey.cameraHere') }}</p></div> }
                  </div>
                }
                <div class="row big-actions">
                  @if (photo()) { <button type="button" class="btn btn-ghost" (click)="retake()">🔄 {{ t()('journey.retake') }}</button> }
                  @else if (camOn()) { <button type="button" class="btn btn-primary" (click)="capture()">📸 {{ t()('journey.takePhoto') }}</button> }
                  @else { <button type="button" class="btn btn-primary" (click)="startCamera()">📷 {{ t()('journey.openCamera') }}</button> }
                  <label class="btn btn-ghost">🖼️ {{ t()('journey.upload') }}<input type="file" accept="image/*" class="sr-only" (change)="upload($event)" /></label>
                </div>
              }
            </div>
          }
          @case ('reveal') {
            <div class="stack center reveal">
              <chakra class="big" [steps]="steps()" [current]="idx()" [spinning]="running()" [finished]="finished()" [beads]="beads()" [hubText]="hub()" data-noread />
              @if (!running() && !finished()) {
                <h2>{{ firstName() ? t()('journey.allSetName', { name: firstName() }) : t()('journey.allSet') }}</h2>
                <p class="muted">{{ t()(tryOn() && consent && photo() ? 'journey.spinHintPhoto' : 'journey.spinHint') }}</p>
                <div class="chips summary">@for (c of summary(); track c) { <span class="pill">{{ c }}</span> }</div>
                <button type="button" class="btn btn-brand spinbtn" (click)="submit()">✨ {{ t()('journey.spin') }}</button>
              } @else {
                <h2 aria-live="polite">{{ finished() ? t()('journey.ready') : t()('journey.working') }}</h2>
                <ol class="agents">
                  @for (a of beads(); track a.id) {
                    <li [class]="a.status"><span class="ic" aria-hidden="true">{{ a.status === 'done' ? '✓' : a.status === 'failed' ? '!' : '' }}</span>{{ t()('agent.' + a.id, null, a.label) }}</li>
                  }
                </ol>
              }
              @if (error()) { <p class="err" role="alert">{{ error() }}</p> <button type="button" class="btn btn-primary" (click)="submit()">{{ t()('common.retry') }}</button> }
            </div>
          }
          @default {
            @if (section(); as sec) {
              <div class="stack">
                @for (f of sec.fields; track f.id) {
                  <question-field [field]="f" [value]="answers()[f.id]" (valueChange)="setAnswer(f.id, $event)" />
                  @if (f.id === 'self_report.face_shape' && measure(); as m) {
                    <p class="from-photo small">📏 {{ t()('journey.fromPhotoShape', { shape: shapeLabel(m.face_shape) }) }}</p>
                  }
                  @if (f.id === 'hair_length_now' && measure()?.hair; as h) {
                    <p class="from-photo small">📏 {{ t()('journey.fromPhoto') }}</p>
                  }
                }
                @if (sec.id === 'quick' && !withMore()) {
                  <button type="button" class="btn btn-ghost more" (click)="addMore()">➕ {{ t()('journey.addMore') }}</button>
                }
              </div>
            }
          }
        }
      </section>
    </main>

    @if (!isReveal()) {
      <div class="actionbar" data-noread><div class="wrap bar">
        @if (idx() > 0) { <button type="button" class="btn btn-ghost" (click)="back()">{{ t()('common.back') }}</button> }
        <button type="button" class="btn btn-primary" [disabled]="!canNext()" (click)="next()">{{ nextLabel() }}</button>
      </div></div>
    }
  `,
  styles: [`
    .layout { display: grid; gap: 20px; }
    .mini { display: grid; grid-template-columns: 112px 1fr; gap: 16px; align-items: center; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
    .mini .wheel { width: 112px; }
    .where .eyebrow { margin: 0 0 2px; }
    .where .title { margin: 0 0 2px; }
    .where p { margin: 0; }
    .steplist { display: none; }
    .revealing .side { display: none; }
    @media (min-width: 900px) {
      .layout { grid-template-columns: 300px 1fr; gap: 56px; align-items: start; }
      .side { position: sticky; top: 84px; }
      .mini { display: block; border: 0; padding: 0; }
      .mini .wheel { width: 100%; max-width: 210px; margin: 0 auto; }
      .where { display: none; }               /* the list below already marks the current step */
      .steplist { display: block; list-style: none; padding: 8px 0 0; margin: 16px 0 0; border-top: 1px solid var(--line); }
      .steplist button { width: 100%; display: flex; gap: 12px; align-items: center; min-height: 40px; border: 0; background: none; color: var(--ink-3); font-weight: 600; text-align: left; border-radius: 10px; padding: 0 8px; cursor: pointer; }
      .steplist button:disabled { cursor: default; }
      .steplist li.done button { color: var(--ink); }
      .steplist li.done button:hover { background: var(--soft); }
      .steplist li.now button { color: var(--ink); font-weight: 800; background: color-mix(in srgb, var(--gold) 22%, #fff); }
      .steplist .n { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--soft); font-size: .8rem; font-weight: 800; flex: none; }
      .steplist li.done .n { background: var(--brand); color: #fff; }
      .steplist li.now .n { background: var(--gold); color: var(--ink); }
      .revealing { grid-template-columns: 1fr; }
    }
    @media (min-width: 900px) and (max-height: 700px) { .steplist { display: none; } .where { display: block; text-align: center; margin-top: 12px; } }
    .content { min-width: 0; }
    .hello { font-size: clamp(1.9rem, 5.4vw, 2.8rem); margin: 0; }
    .hello em { color: var(--brand); font-style: italic; }
    .lead { font-size: 1.05rem; }
    .how { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
    .how li { display: flex; gap: 14px; align-items: flex-start; background: var(--card); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px; }
    .how li > span { font-size: 1.4rem; line-height: 1; padding-top: 2px; }
    .how p { margin: 2px 0 0; }
    .check { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border: 1.5px solid var(--line); border-radius: var(--radius-sm); background: #fff; cursor: pointer; }
    .check:has(input:checked) { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 6%, #fff); }
    .check input { width: 22px; height: 22px; margin-top: 2px; accent-color: var(--brand); flex: none; }
    .camera { position: relative; aspect-ratio: 3 / 4; max-height: 56vh; width: 100%; border-radius: var(--radius); overflow: hidden; background: #1c1916; display: grid; place-items: center; }
    .camera video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
    .guide { position: absolute; inset: 14% 22% 24%; border: 2px dashed rgba(255,255,255,.7); border-radius: 50% / 45%; }
    .placeholder { text-align: center; color: #fff; padding: 16px; } .placeholder span { font-size: 40px; }
    .measured { position: relative; margin: 0 auto; width: 100%; border-radius: var(--radius); overflow: hidden; background: #1c1916; }
    .measured img { width: 100%; height: 100%; object-fit: cover; }
    .measured svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .ml { stroke-linecap: round; stroke-dasharray: 2000; stroke-dashoffset: 2000; animation: draw 1s ease-out forwards; filter: drop-shadow(0 0 2px rgba(0,0,0,.6)); }
    .ml.length { stroke: var(--gold); } .ml.forehead { stroke: #fff; animation-delay: .2s; } .ml.cheek { stroke: #5EEAD4; animation-delay: .35s; } .ml.jaw { stroke: #F9A8D4; animation-delay: .5s; }
    .dot { fill: #fff; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    .scan { position: absolute; left: 0; right: 0; height: 30%; background: linear-gradient(transparent, color-mix(in srgb, var(--gold) 45%, transparent), transparent); animation: scan 1.4s ease-in-out infinite; }
    @keyframes scan { from { top: -30%; } to { top: 100%; } }
    .result .shape { font-family: var(--serif); font-size: 1.6rem; margin: 0; }
    .legend { list-style: none; padding: 0; margin: 10px 0 6px; display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--ink-2); font-weight: 600; }
    .legend li { display: flex; align-items: center; gap: 6px; }
    .k { width: 18px; height: 4px; border-radius: 2px; display: inline-block; }
    .k.length { background: var(--gold); } .k.forehead { background: #A8A29E; } .k.cheek { background: #14B8A6; } .k.jaw { background: #EC4899; }
    .from-photo { margin-top: -6px; color: var(--brand); }
    .found { margin: 8px 0 4px; }
    .sw { width: 12px; height: 12px; border-radius: 50%; display: inline-block; border: 1px solid rgba(0,0,0,.15); }
    .err { color: var(--danger); font-weight: 600; }
    .reveal { padding-top: 4px; }
    .reveal .big { width: min(300px, 80vw); margin: 0 auto 4px; }
    .summary { justify-content: center; }
    .spinbtn { min-width: 240px; font-size: 1.05rem; box-shadow: 0 14px 30px -12px color-mix(in srgb, var(--brand) 70%, transparent); }
    .agents { list-style: none; padding: 0; margin: 0 auto; max-width: 360px; text-align: left; }
    .agents li { display: flex; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); color: var(--ink-3); font-weight: 600; }
    .agents li.running, .agents li.done { color: var(--ink); }
    .agents .ic { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--soft); font-weight: 800; font-size: .75rem; flex: none; }
    .agents .done .ic { background: var(--brand); color: #fff; }
    .agents .failed .ic { background: var(--warn); color: #fff; }
    .agents .running .ic { border: 2px solid var(--gold); border-right-color: transparent; background: none; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .bar { display: flex; gap: 10px; max-width: 640px; }
    .big-actions .btn { flex: 1; min-height: 60px; }
    .more { width: 100%; }
    @media (min-width: 900px) { .bar { max-width: 1080px; justify-content: flex-end; } .bar .btn { flex: 0 0 200px; } }
  `],
})
export class JourneyPage implements OnInit, OnDestroy {
  private api = inject(Api);
  private router = inject(Router);
  private session = inject(PhotoSession);
  private i18n = inject(I18n);
  readonly t = this.i18n.t;
  withMore = signal(false);
  private video = viewChild<ElementRef<HTMLVideoElement>>('video');

  form = signal<IntakeForm | null>(null);
  agents = signal<{ id: string; title: string }[]>([]);
  tryOn = signal(false);
  idx = signal(0);
  answers = signal<Record<string, any>>({});
  photo = signal<string | null>(null);
  imgSize = signal<{ w: number; h: number } | null>(null);
  measure = signal<FaceMeasure | null>(null);
  measuring = signal(false);
  measureError = signal<string | null>(null);
  camOn = signal(false);
  camError = signal<string | null>(null);
  running = signal(false);
  finished = signal(false);
  error = signal<string | null>(null);
  stepStates = signal<Record<string, StepState>>({});
  consent = false;
  private stream = signal<MediaStream | null>(null);
  private pollTimer?: ReturnType<typeof setTimeout>;

  steps = computed(() => journeySteps(this.form(), this.t(), this.withMore()));
  firstName = computed(() => String(this.answers()['name'] ?? '').trim());
  step = computed(() => this.steps().at(this.idx()));
  isReveal = computed(() => this.step()?.id === 'reveal');
  section = computed<FormSection | null>(() => this.form()?.sections.find(s => s.id === this.step()?.id) ?? null);
  beads = computed(() => this.agents().map(a => ({ id: a.id, label: a.title, status: this.stepStates()[a.id]?.status ?? 'pending' })));
  doneCount = computed(() => this.beads().filter(b => b.status === 'done' || b.status === 'skipped').length);
  hub = computed(() => {
    if (this.finished()) return { big: '✓', small: this.t()('journey.readyShort') };
    if (this.running()) return { big: `${this.doneCount()}/${this.agents().length}`, small: this.t()('journey.agents') };
    return null;
  });
  ratio = computed(() => { const s = this.imgSize(); return s ? `${s.w} / ${s.h}` : '3 / 4'; });
  maxW = computed(() => { const s = this.imgSize(); return s ? `calc(56vh * ${s.w / s.h})` : '100%'; });
  nextLabel = computed(() => {
    const id = this.step()?.id;
    if (id === 'hello') return this.t()('journey.begin');
    if (id === 'photo') return this.consent && this.photo() ? (this.measuring() ? this.t()('journey.measuring') : this.t()('journey.usePhoto')) : this.t()('journey.skipPhoto');
    return this.steps()[this.idx() + 1]?.id === 'reveal' ? this.t()('journey.lastStep') : this.t()('common.next');
  });
  summary = computed(() => {
    const a = this.answers(), m = this.measure(), out: string[] = [], t = this.t();
    for (const id of ['gender', 'hair_length_now', 'maintenance']) {
      const v = a[id];
      if (v) out.push(t(`form.${id}.${v}`, null, String(v)));
    }
    const face = a['self_report.face_shape'];
    if (face) out.push(t('journey.faceShape', { shape: this.shapeLabel(face) }) + (m && m.face_shape === face ? ' 📏' : ''));
    return out;
  });

  constructor() {
    effect(() => {
      const v = this.video()?.nativeElement, s = this.stream();
      if (v && s && v.srcObject !== s) { v.srcObject = s; v.play().catch(() => {}); }
    });
  }

  async ngOnInit() {
    warmUp();
    const meta = await this.api.meta();
    this.form.set(meta.forms['intake'] ?? null);
    this.tryOn.set(!!meta.features?.photo_tryon);
    this.agents.set(meta.workflows['consultation']?.steps.map(s => ({ id: s.id, title: s.title })) ?? []);
  }
  ngOnDestroy() { this.stopCamera(); clearTimeout(this.pollTimer); }

  shapeLabel(s: string) { return this.t()(`form.self_report.face_shape.${s}`, null, s); }
  addMore() { this.withMore.set(true); this.go(this.idx() + 1); }
  setAnswer(id: string, v: any) { this.answers.update(a => ({ ...a, [id]: v })); }

  canNext(): boolean {
    const id = this.step()?.id;
    if (id === 'hello') return true;
    if (id === 'photo') return !this.measuring();
    const sec = this.section();
    return !!sec && sec.fields.every(f => f.optional || this.filled(this.answers()[f.id]));
  }
  private filled(v: any) { return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''; }

  next() {
    if (!this.canNext()) return;
    if (this.step()?.id === 'photo') this.stopCamera();
    this.go(this.idx() + 1);
  }
  back() { if (this.step()?.id === 'photo') this.stopCamera(); this.go(this.idx() - 1); }
  go(i: number) {
    if (this.running() || i < 0 || i >= this.steps().length) return;
    this.error.set(null);
    this.idx.set(i);
    scrollTo({ top: 0, behavior: 'smooth' });
  }

  async startCamera() {
    this.camError.set(null);
    try {
      this.stream.set(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false }));
      this.camOn.set(true);
    } catch { this.camError.set('no-camera'); }
  }
  capture() {
    const v = this.video()?.nativeElement;
    if (!v?.videoWidth) return;
    this.setPhoto(videoFrameToDataUrl(v));
    this.stopCamera();
  }
  retake() { this.photo.set(null); this.measure.set(null); this.measureError.set(null); this.startCamera(); }
  stopCamera() { this.stream()?.getTracks().forEach(t => t.stop()); this.stream.set(null); this.camOn.set(false); }
  async upload(ev: Event) {
    const input = ev.target as HTMLInputElement, file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.stopCamera();
    try { this.setPhoto(await fileToDataUrl(file)); } catch { this.measureError.set('unreadable'); }
  }
  onImg(ev: Event) { const i = ev.target as HTMLImageElement; this.imgSize.set({ w: i.naturalWidth, h: i.naturalHeight }); }

  private async setPhoto(src: string) {
    this.photo.set(src); this.measure.set(null); this.measureError.set(null); this.measuring.set(true);
    const res = await measureFace(src);
    if (this.photo() !== src) return;                          // a newer photo replaced this one
    this.measuring.set(false);
    if ('error' in res) { this.measureError.set(res.error); return; }
    this.measure.set(res);
    // pre-fill what the photo showed, unless the customer already answered differently
    const fill = (id: string, v: any) => {
      const prev = this.answers()[id];
      if (prev === undefined || prev === null || prev === this.lastMeasured[id]) this.setAnswer(id, v);
      this.lastMeasured[id] = v;
    };
    fill('self_report.face_shape', res.face_shape);
    if (res.hair) fill('hair_length_now', res.hair.length);
    fill('has_beard', res.beard);
  }
  private lastMeasured: Record<string, any> = {};

  async submit() {
    this.error.set(null); this.running.set(true); this.finished.set(false); this.stepStates.set({});
    const usePhoto = this.consent && !!this.photo();
    const m = usePhoto ? this.measure() : null;
    try {
      const res = await this.api.startConsultation({
        customer: { name: (this.answers()['name'] ?? '').trim() || null, phone: String(this.answers()['phone'] ?? '').trim() || null },
        consent: { photo_processing: usePhoto, store_photo: false },
        answers: { ...this.answers(), language: this.i18n.lang(), name: (this.answers()['name'] ?? '').trim() || null, ...(m ? { photo_measure: {
          face_shape: m.face_shape, confidence: m.confidence, quality: m.quality, notes: m.notes, ratios: m.ratios,
          hair_length: m.hair?.length ?? null, hair_color: m.hair?.color ?? null, beard: m.beard,
          hair_rgb: m.hair?.rgb ?? null, skin_rgb: m.skin,
        } } : {}) },
        photo: usePhoto ? this.photo() : null,
        photo_geometry: usePhoto ? (m?.geometry ?? null) : null,
      });
      this.session.set(usePhoto ? this.photo() : null);
      this.poll(res.id);
    } catch (e: any) {
      this.running.set(false);
      if (e?.status === 401) { this.router.navigate(['/login'], { queryParams: { next: '/start' } }); return; }
      this.error.set(e?.status === 429 || e?.status === 402 ? (e?.error?.detail ?? this.t()('common.netFail')) : this.t()('common.netFail'));
    }
  }
  private poll(id: string) {
    this.api.consultation(id).then(c => {
      this.stepStates.set(c.steps);
      if (c.status === 'done') {
        this.running.set(false); this.finished.set(true);
        this.pollTimer = setTimeout(() => this.router.navigate(['/looks', id], { queryParams: { t: this.api.tenant() } }), 1300);
        return;
      }
      if (c.status === 'failed') { this.running.set(false); this.error.set(this.t()('journey.failed')); return; }
      this.pollTimer = setTimeout(() => this.poll(id), 700);
    }).catch(() => { this.pollTimer = setTimeout(() => this.poll(id), 1500); });
  }
}
