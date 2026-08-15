SELECT id, name, agent_config
FROM "TeamSlot"
WHERE type = 'AI_AGENT'
  AND agent_role = 'sales'
  AND agent_config->>'evolution_instance' = 'Mentoriacomercial';
