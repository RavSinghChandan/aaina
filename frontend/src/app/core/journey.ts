import { IntakeForm } from './models';
import { ChakraStep } from '../shared/chakra';

type T = (key: string, params?: Record<string, string | number> | null, fallback?: string) => string;

/**
 * Every step on the wheel. The quick path is hello, photo, three taps, reveal;
 * the `more` sections of the form join only when someone asks for more detail.
 */
export function journeySteps(form: IntakeForm | null, t: T, withMore: boolean): (ChakraStep & { hint: string })[] {
  const sections = (form?.sections ?? []).filter(s => !s.more || withMore);
  return [
    { id: 'hello', label: t('step.hello'), hint: t('step.helloHint') },
    { id: 'photo', label: t('step.photo'), hint: t('step.photoHint') },
    ...sections.map(s => ({ id: s.id, label: t(`section.${s.id}`, null, s.title), hint: t(`section.${s.id}.hint`, null, '') })),
    { id: 'reveal', label: t('step.reveal'), hint: t('step.revealHint') },
  ];
}
