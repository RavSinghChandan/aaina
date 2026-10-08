import { Component, computed, inject, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n } from '../core/i18n';
import { FormField } from '../core/models';

/**
 * Renders one intake question from the form manifest. Words come from the
 * language files (form.<id>, form.<id>.<value>), falling back to the manifest's
 * English. Choices with icons become big picture tiles.
 */
@Component({
  selector: 'question-field',
  imports: [FormsModule],
  template: `
    @let f = field();
    <div class="field">
      <span class="label" [id]="f.id + '-l'">{{ label() }} @if (f.optional) {<span class="muted small">({{ t()('common.optional') }})</span>}</span>
      @switch (f.type) {
        @case ('text') {
          <input class="input" [attr.aria-labelledby]="f.id + '-l'" [placeholder]="placeholder()" [ngModel]="value() ?? ''" (ngModelChange)="value.set($event)" />
        }
        @case ('tel') {
          <input class="input" type="tel" inputmode="tel" autocomplete="tel" [attr.aria-labelledby]="f.id + '-l'" [placeholder]="placeholder()" [ngModel]="value() ?? ''" (ngModelChange)="value.set($event)" />
        }
        @case ('choice') {
          <div [class]="pictures() ? 'tiles' : 'chips'" role="radiogroup" [attr.aria-labelledby]="f.id + '-l'">
            @for (o of f.options ?? []; track o.value) {
              <button type="button" [class]="pictures() ? 'tile' : 'chip'" role="radio" [attr.aria-checked]="value() === o.value" [class.on]="value() === o.value"
                      (click)="value.set(value() === o.value && f.optional ? null : o.value)">
                @if (o.icon) { <span class="ic" aria-hidden="true">{{ o.icon }}</span> }{{ opt(o.value, o.label) }}
              </button>
            }
          </div>
        }
        @case ('multi') {
          <div class="chips" role="group" [attr.aria-labelledby]="f.id + '-l'">
            @for (o of f.options ?? []; track o.value) {
              <button type="button" class="chip" [attr.aria-pressed]="has(o.value)" [class.on]="has(o.value)" (click)="toggle(o.value)">{{ opt(o.value, o.label) }}</button>
            }
          </div>
        }
        @case ('tags') {
          <div class="chips tags">
            @for (x of list(); track x) { <button type="button" class="chip on" (click)="toggle(x)">{{ x }} ✕</button> }
          </div>
          <input class="input" [attr.aria-labelledby]="f.id + '-l'" [placeholder]="placeholder() + ' — ' + t()('form.enterToAdd')" #tag
                 (keydown.enter)="$event.preventDefault(); add(tag.value); tag.value=''" (blur)="add(tag.value); tag.value=''" />
        }
        @case ('toggle') {
          <div class="chips">
            <button type="button" class="chip" [class.on]="value() === true" [attr.aria-pressed]="value() === true" (click)="value.set(true)">{{ t()('common.yes') }}</button>
            <button type="button" class="chip" [class.on]="value() === false" [attr.aria-pressed]="value() === false" (click)="value.set(false)">{{ t()('common.no') }}</button>
          </div>
        }
      }
      @if (hint()) { <span class="hint">{{ hint() }}</span> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .tags { margin-bottom: 8px; } .tags:empty { display: none; }
    .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 104px; padding: 10px 6px;
            border-radius: var(--radius-sm); border: 2px solid var(--line); background: #fff; font: inherit; font-weight: 700; font-size: .95rem; color: var(--ink); cursor: pointer; text-align: center; }
    .tile .ic { font-size: 2.2rem; line-height: 1; }
    .tile.on { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, #fff); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 22%, transparent); }
  `],
})
export class QuestionField {
  field = input.required<FormField>();
  value = model<any>();
  readonly t = inject(I18n).t;
  pictures = computed(() => (this.field().options ?? []).some(o => o.icon));
  label = computed(() => this.t()(`form.${this.field().id}`, null, this.field().label));
  placeholder = computed(() => this.field().placeholder ? this.t()(`form.${this.field().id}.ph`, null, this.field().placeholder) : '');
  hint = computed(() => this.field().hint ? this.t()(`form.${this.field().id}.hint`, null, this.field().hint) : '');
  opt(value: string, fallback: string) { return this.t()(`form.${this.field().id}.${value}`, null, fallback); }
  list(): string[] { return Array.isArray(this.value()) ? this.value() : []; }
  has(v: string) { return this.list().includes(v); }
  toggle(v: string) { this.value.set(this.has(v) ? this.list().filter(x => x !== v) : [...this.list(), v]); }
  add(v: string) { v = v.trim(); if (v && !this.has(v)) this.value.set([...this.list(), v]); }
}
