UPDATE "TeamSlot"
SET agent_config = agent_config || '{"escalation_phone": "2225771704"}'::jsonb
WHERE type = 'AI_AGENT'
  AND agent_role = 'sales'
  AND agent_config->>'evolution_instance' = 'Mentoriacomercial';
