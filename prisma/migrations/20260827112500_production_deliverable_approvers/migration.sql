-- Preserve production approval provenance through explicit user relations.
ALTER TABLE `production_deliverables`
  ADD CONSTRAINT `production_deliverables_approved_by_user_id_fkey`
    FOREIGN KEY (`approved_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `production_approval_gates`
  ADD CONSTRAINT `production_approval_gates_decided_by_user_id_fkey`
    FOREIGN KEY (`decided_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
