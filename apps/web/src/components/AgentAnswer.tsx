import type { ReactElement } from 'react';
import type { ComponentSpec } from '@polymath/contract';

type AgentAnswerSpec = Extract<ComponentSpec, { kind: 'AgentAnswer' }>;

/**
 * Renders the agent's bounded conversational answer (ADR-003 topic guardrail). An
 * on-topic answer is shown plainly; an off-topic question gets the deflection text
 * the agent supplied, flagged so the learner sees it's a redirect, not an answer.
 */
export function AgentAnswer({ spec }: { spec: AgentAnswerSpec }): ReactElement {
  const offTopic = spec.topicClassification === 'off_topic';
  return (
    <section
      className="agent-answer"
      data-topic={spec.topicClassification}
      aria-label={offTopic ? 'Off-topic redirect' : 'Answer'}
    >
      <p className="agent-answer__q">
        <strong>You asked:</strong> {spec.question}
      </p>
      <p className="agent-answer__a" aria-live="polite">
        {spec.answer}
      </p>
    </section>
  );
}
