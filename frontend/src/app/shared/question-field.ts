import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormField } from '../core/models';

/** Renders one intake question from the form manifest. */
@Component({
  selector: 'question-field',
  imports: [FormsModule],
  template: `
    @let f = field();
    <div class="field">
      <span class="label" [id]="f.id + '-l'">{{ f.label }} @if (f.optional) {<span class="muted small">(optional)</span>}</span>
      @switch (f.type) {
        @case ('text') {
          <input class="input" [attr.aria-labelledby]="f.id + '-l'" [placeholder]="f.placeholder ?? ''" [ngModel]="value() ?? ''" (ngModelChange)="value.set($event)" />
        }
        @case ('choice') {
          <div class="chips" role="radiogroup" [attr.aria-labelledby]="f.id + '-l'">
            @for (o of f.options ?? []; track o.value) {
              <button type="button" class="chip" role="radio" [attr.aria-checked]="value() === o.value" [class.on]="value() === o.value" (click)="value.set(value() === o.value && f.optional ? null : o.value)">{{ o.label }}</button>
            }
          </div>
        }
        @case ('multi') {
          <div class="chips" role="group" [attr.aria-labelledby]="f.id + '-l'">
            @for (o of f.options ?? []; track o.value) {
              <button type="button" class="chip" [attr.aria-pressed]="has(o.value)" [class.on]="has(o.value)" (click)="toggle(o.value)">{{ o.label }}</button>
            }
          </div>
        }
        @case ('tags') {
          <div class="chips tags">
            @for (t of list(); track t) { <button type="button" class="chip on" (click)="toggle(t)" [attr.aria-label]="'Remove ' + t">{{ t }} ✕</button> }
          </div>
          <input class="input" [attr.aria-labelledby]="f.id + '-l'" [placeholder]="(f.placeholder ?? '') + ' — press Enter to add'" #tag
                 (keydown.enter)="$event.preventDefault(); add(tag.value); tag.value=''" (blur)="add(tag.value); tag.value=''" />
        }
        @case ('toggle') {
          <button type="button" class="chip" [class.on]="!!value()" [attr.aria-pressed]="!!value()" (click)="value.set(!value())">{{ value() ? 'Yes' : 'No' }}</button>
        }
      }
      @if (f.hint) { <span class="hint">{{ f.hint }}</span> }
    </div>
  `,
  styles: [`.tags { margin-bottom: 8px; } .tags:empty { display: none; }`],
})
export class QuestionField {
  field = input.required<FormField>();
  value = model<any>();
  list(): string[] { return Array.isArray(this.value()) ? this.value() : []; }
  has(v: string) { return this.list().includes(v); }
  toggle(v: string) { this.value.set(this.has(v) ? this.list().filter(x => x !== v) : [...this.list(), v]); }
  add(v: string) { v = v.trim(); if (v && !this.has(v)) this.value.set([...this.list(), v]); }
}
