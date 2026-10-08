export interface FormOption { value: string; label: string; icon?: string; }
export interface FormField {
  id: string; label: string; type: 'text' | 'tel' | 'choice' | 'multi' | 'tags' | 'toggle';
  options?: FormOption[]; optional?: boolean; placeholder?: string; hint?: string;
}
export interface FormSection { id: string; title: string; fields: FormField[]; more?: boolean; }
export interface IntakeForm { id: string; title: string; sections: FormSection[]; }
export interface UiEntry { id: string; title: string; view: string; order: number; hidden: boolean; description: string; }
export interface WorkflowMeta { title: string; steps: { id: string; agent: string; title: string }[]; }
export interface Meta { features?: { photo_tryon: boolean }; ui: UiEntry[]; forms: Record<string, IntakeForm>; workflows: Record<string, WorkflowMeta>; }
export interface StepState { status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; source?: string | null; ms?: number; error?: string | null; }
export interface StyleOption {
  style_id: string; name: string; match_score: number; why: string; suits: string[]; watch_out: string;
  maintenance: string; trim_weeks: number; styling_minutes: number; how_to_ask: string; styling_tip: string;
}
export interface Consultation {
  id: string; status: 'queued' | 'running' | 'done' | 'failed'; workflow: string;
  steps: Record<string, StepState>; outputs: Record<string, any>; chosen_style_id: string | null;
  error: string | null; created_at: string; customer: { id: string; name: string | null }; photo: string | null;
}
export interface CustomerRow { id: string; name: string | null; phone: string | null; visits: number; last_visit: string | null; chosen_style_id: string | null; }
export interface CustomerDetail {
  id: string; name: string | null; phone: string | null;
  consultations: { id: string; status: string; created_at: string; chosen_style_id: string | null }[];
  calendar: { events: { date: string; title: string; kind: string; detail: string }[] } | null;
}
export interface AgendaItem { date: string; title: string; kind: string; detail: string; customer: { id: string; name: string | null; phone: string | null }; }
