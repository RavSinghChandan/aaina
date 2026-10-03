import { IntakeForm } from './models';
import { ChakraStep } from '../shared/chakra';

/** Every step on the wheel. The question steps come from the form manifest, so a new section adds a spoke. */
export function journeySteps(form: IntakeForm | null): (ChakraStep & { hint: string })[] {
  return [
    { id: 'hello', label: 'Hello', hint: 'How it works, and your say over your photo' },
    { id: 'photo', label: 'Your photo', hint: 'One selfie. We measure your face shape on your phone' },
    ...(form?.sections ?? []).map(s => ({ id: s.id, label: s.title, hint: s.fields.slice(0, 3).map(f => f.label.replace(/[?…]/g, '')).join(' · ') })),
    { id: 'reveal', label: 'Reveal', hint: 'Spin the chakra. AI agents pick 3 cuts, routines and a calendar' },
  ];
}
