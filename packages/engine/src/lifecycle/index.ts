/**
 * The hand-lifecycle state machine: the phase vocabulary, the legal-transition
 * table, and the variant-aware active-path resolver. Structure only — no phase
 * logic.
 */
export {
  LIFECYCLE_PHASES,
  OPTIONAL_PHASES,
  isLegalTransition,
  resolveActivePath,
  type LifecyclePhase,
} from './phases';
