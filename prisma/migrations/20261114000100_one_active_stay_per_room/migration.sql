-- At most one active stay per room; the database enforces it even under concurrent check-ins.
CREATE UNIQUE INDEX stays_one_active_per_room ON stays (room_id) WHERE status = 'ACTIVE';
